import Homey from 'homey';
import { SesamClient } from '../../lib/SesamClient';
import { CheckUnpaidResult, UnpaidParkingItem } from '../../lib/types';

module.exports = class VehicleDevice extends Homey.Device {

  private pollTimer: NodeJS.Timeout | null = null;
  private knownParkingIds: Set<string> = new Set();
  private warnedDeadlineIds: Set<string> = new Set();

  async onInit(): Promise<void> {
    this.log(`VehicleDevice initialisert: ${this.getName()}`);

    // Sikre at custom capabilities er lagt til dersom de mangler
    await this.ensureCapabilities();

    // Registrer knapp-lytter for Sjekk parkering nå
    if (this.hasCapability('button_sync')) {
      this.registerCapabilityListener('button_sync', async () => {
        this.log(`Manuell sjekk-knapp trykket for ${this.getName()}`);
        await this.syncUnpaidParking();
      });
    }

    // Start periodisk sjekk
    this.restartPolling();

    // Kjør en første sjekk etter 3 sekunder
    this.homey.setTimeout(() => {
      this.syncUnpaidParking().catch(err => {
        this.error(`Feil under initial synkronisering: ${err.message}`);
      });
    }, 3000);
  }

  async onSettings({ newSettings, changedKeys }: {
    oldSettings: Record<string, any>;
    newSettings: Record<string, any>;
    changedKeys: string[];
  }): Promise<void> {
    this.log('Enhetsinnstillinger endret:', changedKeys);

    if (changedKeys.includes('poll_interval')) {
      this.restartPolling(newSettings.poll_interval);
    }

    if (changedKeys.includes('reg_number')) {
      this.knownParkingIds.clear();
      this.warnedDeadlineIds.clear();
      await this.syncUnpaidParking(newSettings.reg_number);
    }
  }

  async onDeleted(): Promise<void> {
    this.log(`VehicleDevice slettet: ${this.getName()}`);
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Sikrer at enheten har alle nødvendige capabilities.
   */
  private async ensureCapabilities(): Promise<void> {
    if (this.hasCapability('button_sesam_pay')) {
      await this.removeCapability('button_sesam_pay').catch(() => {});
    }

    const required = [
      'alarm_generic',
      'sesam_unpaid_amount',
      'sesam_facility',
      'sesam_hours_remaining',
      'sesam_payment_url',
      'button_sync',
    ];

    for (const cap of required) {
      if (!this.hasCapability(cap)) {
        try {
          await this.addCapability(cap);
        } catch (err: any) {
          this.error(`Kunne ikke legge til capability ${cap}:`, err.message);
        }
      }
    }
  }

  /**
   * Restarter tidsstyrt intervall-sjekk.
   */
  private restartPolling(customIntervalMinutes?: number): void {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    const intervalMinutes = customIntervalMinutes || this.getSetting('poll_interval') || 30;
    const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;

    this.log(`Setter opp polling hvert ${intervalMinutes}. minutt (${intervalMs} ms)`);
    this.pollTimer = this.homey.setInterval(() => {
      this.syncUnpaidParking().catch(err => {
        this.error(`Feil under automatisk intervallsjekk: ${err.message}`);
      });
    }, intervalMs);
  }

  /**
   * Formaterer dato for visning (DD.MM.YYYY HH:mm).
   */
  private formatDateTime(d: Date | null): string {
    if (!d) return 'Ukjent';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Formaterer et tidslinje-varsel.
   */
  public formatTimelineText(p: UnpaidParkingItem, paymentUrl: string): string {
    const reg = this.getSetting('reg_number') || this.getData().regNumber || this.getName();
    const deadlineStr = this.formatDateTime(p.deadline);
    const hours = p.hoursRemaining !== undefined ? `${p.hoursRemaining}t` : '48t';

    return `🚗 Sesam Pay: Ubetalt parkering for ${reg}!\n\n`
      + `📍 Sted: ${p.facility}\n`
      + `💰 Beløp: ${p.amount} NOK\n`
      + `⏳ Frist: ${deadlineStr} (${hours} igjen)\n\n`
      + `👉 Åpne Sesam Pay i Homey for å betale gebyrfritt.`;
  }

  /**
   * Formaterer et kort push-varsel.
   */
  public formatPushText(p: UnpaidParkingItem, paymentUrl: string): string {
    const reg = this.getSetting('reg_number') || this.getData().regNumber || this.getName();
    return `🚗 ${reg}: Ubetalt parkering på ${p.facility} (${p.amount} kr, ${p.hoursRemaining ?? 48}t igjen). Åpne Sesam Pay i Homey for å betale.`;
  }

  /**
   * Sender tidslinje-varsel for gjeldende ubetalte parkering.
   */
  public async sendTimelineNotification(): Promise<void> {
    const hasUnpaid = this.getCapabilityValue('alarm_generic') === true;
    if (!hasUnpaid) {
      this.log('Ingen ubetalt parkering å sende tidslinjevarsel for.');
      return;
    }

    const facility = String(this.getCapabilityValue('sesam_facility') || 'Sesam');
    const amount = Number(this.getCapabilityValue('sesam_unpaid_amount') || 0);
    const hoursRemaining = Number(this.getCapabilityValue('sesam_hours_remaining') || 0);
    const paymentUrl = String(this.getCapabilityValue('sesam_payment_url') || 'https://sesam-sesam.com/betal-for-parkering/');

    const pseudoItem: UnpaidParkingItem = {
      id: 'active',
      facility,
      amount,
      hoursRemaining,
      currency: 'NOK',
      deadline: new Date(Date.now() + hoursRemaining * 3600 * 1000),
      startTime: null,
      endTime: null,
    };

    const message = this.formatTimelineText(pseudoItem, paymentUrl);
    await this.homey.notifications.createNotification({
      excerpt: message,
    }).catch(this.error);

    this.log('Tidslinjevarsel ble opprettet i Homey.');
  }

  /**
   * Utfører sjekk mot Sesam Sesam og oppdaterer tilstand + trigger Flow cards.
   */
  public async syncUnpaidParking(customRegNumber?: string): Promise<CheckUnpaidResult> {
    const regNumber = customRegNumber || this.getSetting('reg_number') || this.getData().regNumber;
    if (!regNumber) {
      throw new Error('Mangler registreringsnummer for kjøretøyet.');
    }

    this.log(`Sjekker ubetalt parkering for ${regNumber}...`);
    const result = await SesamClient.checkUnpaid(regNumber);
    const email = this.getSetting('email') || undefined;

    const hadUnpaidBefore = this.getCapabilityValue('alarm_generic') === true;

    if (result.hasUnpaid && result.parkings.length > 0) {
      const primary = result.parkings[0];

      // Hent direkte betalingslenke hvis mulig
      let paymentUrl = 'https://sesam-sesam.com/betal-for-parkering/';
      try {
        const payRes = await SesamClient.getPaymentRedirectUrl(primary.id, email);
        if (payRes && payRes.redirectUrl) {
          paymentUrl = payRes.redirectUrl;
        }
      } catch (err: any) {
        this.error(`Kunne ikke generere direktelenke, faller tilbake til standardside: ${err.message}`);
      }

      // Oppdater capabilities
      await this.setCapabilityValue('alarm_generic', true).catch(this.error);
      await this.setCapabilityValue('sesam_unpaid_amount', result.totalAmount).catch(this.error);
      await this.setCapabilityValue('sesam_facility', primary.facility).catch(this.error);
      await this.setCapabilityValue('sesam_hours_remaining', primary.hoursRemaining ?? 0).catch(this.error);
      await this.setCapabilityValue('sesam_payment_url', paymentUrl).catch(this.error);

      const deadlineStr = this.formatDateTime(primary.deadline);
      const formattedMessage = this.formatTimelineText(primary, paymentUrl);

      // Sjekk om det er nye parkeringer vi ikke har varslet om
      for (const p of result.parkings) {
        if (!this.knownParkingIds.has(p.id)) {
          this.knownParkingIds.add(p.id);
          this.log(`Ny ubetalt parkering funnet (${p.id}): ${p.facility} - ${p.amount} kr`);

          // Automatisk tidslinjevarsel dersom aktivert i innstillinger
          const autoTimeline = this.getSetting('auto_timeline') !== false;
          if (autoTimeline) {
            await this.homey.notifications.createNotification({
              excerpt: formattedMessage,
            }).catch(this.error);
          }

          // Trigger flow for ny ubetalt parkering
          const app = this.homey.app as any;
          if (app.triggerUnpaidParkingFound) {
            await app.triggerUnpaidParkingFound(this, {
              regnr: result.regNumber,
              facility: p.facility,
              amount: p.amount,
              hours_remaining: p.hoursRemaining ?? 48,
              deadline_str: deadlineStr,
              formatted_message: formattedMessage,
              payment_url: paymentUrl,
              end_time: p.endTimeStr || '',
            });
          }
        }

        // Sjekk om fristen nærmer seg (< 12 timer) og vi ikke har varslet ennå
        if (p.hoursRemaining !== undefined && p.hoursRemaining <= 12 && !this.warnedDeadlineIds.has(p.id)) {
          this.warnedDeadlineIds.add(p.id);
          this.log(`Advarsel: Betalingsfrist under 12 timer for (${p.id}): ${p.hoursRemaining}t igjen`);

          const warnMessage = `⏳ VIKTIG: Betalingsfrist utløper om ${p.hoursRemaining} timer for ${result.regNumber} (${p.facility}, ${p.amount} kr)!\nBetal gebyrfritt før fakturagebyr påløper:\n${paymentUrl}`;

          // Tidslinjevarsel
          await this.homey.notifications.createNotification({
            excerpt: warnMessage,
          }).catch(this.error);

          const app = this.homey.app as any;
          if (app.triggerDeadlineApproaching) {
            await app.triggerDeadlineApproaching(this, {
              regnr: result.regNumber,
              facility: p.facility,
              amount: p.amount,
              hours_remaining: p.hoursRemaining,
              deadline_str: deadlineStr,
              formatted_message: warnMessage,
              payment_url: paymentUrl,
            });
          }
        }
      }
    } else {
      // Ingen ubetalte parkeringer
      if (hadUnpaidBefore) {
        this.log(`Parkering er nå oppgjort/betalt for ${regNumber}!`);
        const previousFacility = this.getCapabilityValue('sesam_facility') || 'Sesam';
        const previousAmount = this.getCapabilityValue('sesam_unpaid_amount') || 0;

        // Tidslinje for bekreftelse
        await this.homey.notifications.createNotification({
          excerpt: `✅ Parkering oppgjort for ${regNumber} (${previousFacility}, ${previousAmount} kr). Ingen utestående betalinger!`,
        }).catch(this.error);

        const app = this.homey.app as any;
        if (app.triggerParkingPaid) {
          await app.triggerParkingPaid(this, {
            regnr: result.regNumber,
            facility: String(previousFacility),
            amount: Number(previousAmount),
          });
        }
      }

      this.knownParkingIds.clear();
      this.warnedDeadlineIds.clear();

      await this.setCapabilityValue('alarm_generic', false).catch(this.error);
      await this.setCapabilityValue('sesam_unpaid_amount', 0).catch(this.error);
      await this.setCapabilityValue('sesam_facility', 'Ingen').catch(this.error);
      await this.setCapabilityValue('sesam_hours_remaining', 0).catch(this.error);
      await this.setCapabilityValue('sesam_payment_url', '').catch(this.error);
    }

    return result;
  }

};
