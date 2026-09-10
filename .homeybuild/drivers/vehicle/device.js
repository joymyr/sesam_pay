"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const SesamClient_1 = require("../../lib/SesamClient");
module.exports = class VehicleDevice extends homey_1.default.Device {
    constructor() {
        super(...arguments);
        this.currentPaymentUrl = '';
        this.pollTimer = null;
        this.knownParkingIds = new Set();
        this.warnedDeadlineIds = new Set();
    }
    async onInit() {
        this.log(`VehicleDevice initialisert: ${this.getName()}`);
        // Sikre at custom capabilities er lagt til dersom de mangler
        await this.ensureCapabilities();
        // Start periodisk sjekk
        this.restartPolling();
        // Kjør en første sjekk etter 3 sekunder
        this.homey.setTimeout(() => {
            this.syncUnpaidParking().catch(err => {
                this.error(`Feil under initial synkronisering: ${err.message}`);
            });
        }, 3000);
    }
    async onSettings({ newSettings, changedKeys }) {
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
    async onDeleted() {
        this.log(`VehicleDevice slettet: ${this.getName()}`);
        if (this.pollTimer) {
            this.homey.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    /**
     * Sikrer at enheten har alle nødvendige capabilities.
     */
    async ensureCapabilities() {
        if (this.hasCapability('button_sesam_pay')) {
            await this.removeCapability('button_sesam_pay').catch(() => { });
        }
        if (this.hasCapability('button_sync')) {
            await this.removeCapability('button_sync').catch(() => { });
        }
        if (this.hasCapability('sesam_payment_url')) {
            await this.removeCapability('sesam_payment_url').catch(() => { });
        }
        if (this.hasCapability('measure_unpaid_amount')) {
            await this.removeCapability('measure_unpaid_amount').catch(() => { });
        }
        if (this.hasCapability('measure_hours_remaining')) {
            await this.removeCapability('measure_hours_remaining').catch(() => { });
        }
        const required = [
            'alarm_generic',
            'sesam_unpaid_amount',
            'sesam_hours_remaining',
            'sesam_facility',
            'sesam_payment_status',
        ];
        for (const cap of required) {
            if (!this.hasCapability(cap)) {
                try {
                    await this.addCapability(cap);
                }
                catch (err) {
                    this.error(`Kunne ikke legge til capability ${cap}:`, err.message);
                }
            }
        }
        if (!this.getCapabilityValue('sesam_payment_status')) {
            await this.setCapabilityValue('sesam_payment_status', 'Betale').catch(() => { });
        }
    }
    /**
     * Restarter tidsstyrt intervall-sjekk.
     */
    restartPolling(customIntervalMinutes) {
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
    formatDateTime(d) {
        if (!d)
            return 'Ukjent';
        const pad = (n) => n.toString().padStart(2, '0');
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    /**
     * Formaterer et tidslinje-varsel (for Homey Timeline).
     */
    formatTimelineText(p, paymentUrl) {
        const devName = this.getName();
        const deadlineStr = this.formatDateTime(p.deadline);
        const hours = p.hoursRemaining !== undefined ? `${p.hoursRemaining}t` : '48t';
        return `🚗 Sesam Pay: Ubetalt parkering for ${devName}!\n\n`
            + `📍 Sted: ${p.facility}\n`
            + `💰 Beløp: ${p.amount} NOK\n`
            + `⏳ Frist: ${deadlineStr} (${hours} igjen)\n\n`
            + `👉 Åpne "${devName}" for å betale.`;
    }
    /**
     * Formaterer en rik tekst med direkte betalingslenke for Slack, e-post og Flow-kort.
     */
    formatFlowMessage(p, paymentUrl) {
        const devName = this.getName();
        const deadlineStr = this.formatDateTime(p.deadline);
        const hours = p.hoursRemaining !== undefined ? `${p.hoursRemaining}t` : '48t';
        return `🚗 *Ubetalt parkering for ${devName}!* (${p.amount} kr)\n\n`
            + `📍 *Sted:* ${p.facility}\n`
            + `💰 *Beløp:* ${p.amount} NOK\n`
            + `⏳ *Frist:* ${deadlineStr} (${hours} igjen)\n\n`
            + `💳 *Betal gebyrfritt her:*\n${paymentUrl}`;
    }
    /**
     * Formaterer en advarseltekst for Flow når fristen nærmer seg.
     */
    formatDeadlineFlowMessage(p, paymentUrl) {
        const devName = this.getName();
        const deadlineStr = this.formatDateTime(p.deadline);
        const hours = p.hoursRemaining !== undefined ? `${p.hoursRemaining}t` : '12t';
        return `⏳ *VIKTIG: Betalingsfrist utløper om ${hours} for ${devName}!* (${p.amount} kr)\n\n`
            + `📍 *Sted:* ${p.facility}\n`
            + `💰 *Beløp:* ${p.amount} NOK\n`
            + `⏳ *Frist:* ${deadlineStr}\n\n`
            + `💳 *Betal gebyrfritt før gebyr påløper:*\n${paymentUrl}`;
    }
    /**
     * Formaterer et kort push-varsel.
     */
    formatPushText(p, paymentUrl) {
        const devName = this.getName();
        return `🚗 ${devName}: Ubetalt parkering på ${p.facility} (${p.amount} kr, ${p.hoursRemaining ?? 48}t igjen). Åpne "${devName}" for å betale.`;
    }
    /**
     * Sender tidslinje-varsel for gjeldende ubetalte parkering.
     */
    async sendTimelineNotification() {
        const hasUnpaid = this.getCapabilityValue('alarm_generic') === true;
        if (!hasUnpaid) {
            this.log('Ingen ubetalt parkering å sende tidslinjevarsel for.');
            return;
        }
        const facility = String(this.getCapabilityValue('sesam_facility') || 'Sesam');
        const amountStr = String(this.getCapabilityValue('sesam_unpaid_amount') || '0 kr');
        const hoursStr = String(this.getCapabilityValue('sesam_hours_remaining') || '0 t');
        const parsedAmount = parseFloat(amountStr) || 0;
        const parsedHours = parseFloat(hoursStr) || 0;
        const paymentUrl = this.currentPaymentUrl || 'https://sesam-sesam.com/betal-for-parkering/';
        const pseudoItem = {
            id: 'active',
            facility,
            amount: parsedAmount,
            hoursRemaining: parsedHours,
            currency: 'NOK',
            deadline: new Date(Date.now() + parsedHours * 3600 * 1000),
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
    async syncUnpaidParking(customRegNumber) {
        const regNumber = customRegNumber || this.getSetting('reg_number') || this.getData().regNumber;
        if (!regNumber) {
            throw new Error('Mangler registreringsnummer for kjøretøyet.');
        }
        const devName = this.getName();
        this.log(`Sjekker ubetalt parkering for ${devName} (${regNumber})...`);
        const result = await SesamClient_1.SesamClient.checkUnpaid(regNumber);
        const email = this.getSetting('email') || undefined;
        const hadUnpaidBefore = this.getCapabilityValue('alarm_generic') === true;
        if (result.hasUnpaid && result.parkings.length > 0) {
            const primary = result.parkings[0];
            // Hent direkte betalingslenke hvis mulig
            let paymentUrl = 'https://sesam-sesam.com/betal-for-parkering/';
            try {
                const payRes = await SesamClient_1.SesamClient.getPaymentRedirectUrl(primary.id, email);
                if (payRes && payRes.redirectUrl) {
                    paymentUrl = payRes.redirectUrl;
                }
            }
            catch (err) {
                this.error(`Kunne ikke generere direktelenke, faller tilbake til standardside: ${err.message}`);
            }
            this.currentPaymentUrl = paymentUrl;
            // Oppdater capabilities
            await this.setCapabilityValue('alarm_generic', true).catch(this.error);
            await this.setCapabilityValue('sesam_unpaid_amount', `${result.totalAmount} kr`).catch(this.error);
            await this.setCapabilityValue('sesam_hours_remaining', `${primary.hoursRemaining ?? 0} t`).catch(this.error);
            await this.setCapabilityValue('sesam_facility', primary.facility).catch(this.error);
            await this.setCapabilityValue('sesam_payment_status', 'Betale').catch(this.error);
            const deadlineStr = this.formatDateTime(primary.deadline);
            const timelineMessage = this.formatTimelineText(primary, paymentUrl);
            const flowMessage = this.formatFlowMessage(primary, paymentUrl);
            // Sjekk om det er nye parkeringer vi ikke har varslet om
            for (const p of result.parkings) {
                if (!this.knownParkingIds.has(p.id)) {
                    this.knownParkingIds.add(p.id);
                    this.log(`Ny ubetalt parkering funnet (${p.id}): ${p.facility} - ${p.amount} kr`);
                    // Automatisk tidslinjevarsel dersom aktivert i innstillinger
                    const autoTimeline = this.getSetting('auto_timeline') !== false;
                    if (autoTimeline) {
                        await this.homey.notifications.createNotification({
                            excerpt: timelineMessage,
                        }).catch(this.error);
                    }
                    // Trigger flow for ny ubetalt parkering
                    const app = this.homey.app;
                    if (app.triggerUnpaidParkingFound) {
                        await app.triggerUnpaidParkingFound(this, {
                            regnr: result.regNumber,
                            facility: p.facility,
                            amount: p.amount,
                            hours_remaining: p.hoursRemaining ?? 48,
                            deadline_str: deadlineStr,
                            formatted_message: flowMessage,
                            payment_url: paymentUrl,
                            end_time: p.endTimeStr || '',
                        });
                    }
                }
                // Sjekk om fristen nærmer seg (< 12 timer) og vi ikke har varslet ennå
                if (p.hoursRemaining !== undefined && p.hoursRemaining <= 12 && !this.warnedDeadlineIds.has(p.id)) {
                    this.warnedDeadlineIds.add(p.id);
                    this.log(`Advarsel: Betalingsfrist under 12 timer for (${p.id}): ${p.hoursRemaining}t igjen`);
                    const warnTimeline = `⏳ VIKTIG: Betalingsfrist utløper om ${p.hoursRemaining} timer for ${devName} (${p.facility}, ${p.amount} kr)!\nÅpne "${devName}" for å betale.`;
                    const warnFlow = this.formatDeadlineFlowMessage(p, paymentUrl);
                    // Tidslinjevarsel
                    await this.homey.notifications.createNotification({
                        excerpt: warnTimeline,
                    }).catch(this.error);
                    const app = this.homey.app;
                    if (app.triggerDeadlineApproaching) {
                        await app.triggerDeadlineApproaching(this, {
                            regnr: result.regNumber,
                            facility: p.facility,
                            amount: p.amount,
                            hours_remaining: p.hoursRemaining,
                            deadline_str: deadlineStr,
                            formatted_message: warnFlow,
                            payment_url: paymentUrl,
                        });
                    }
                }
            }
        }
        else {
            // Ingen ubetalte parkeringer
            if (hadUnpaidBefore) {
                this.log(`Parkering er nå oppgjort/betalt for ${devName} (${regNumber})!`);
                const previousFacility = this.getCapabilityValue('sesam_facility') || 'Sesam';
                const previousAmount = this.getCapabilityValue('sesam_unpaid_amount') || '0 kr';
                // Tidslinje for bekreftelse
                await this.homey.notifications.createNotification({
                    excerpt: `✅ Parkering oppgjort for ${devName} (${previousFacility}, ${previousAmount}). Ingen utestående betalinger!`,
                }).catch(this.error);
                const app = this.homey.app;
                if (app.triggerParkingPaid) {
                    await app.triggerParkingPaid(this, {
                        regnr: result.regNumber,
                        facility: String(previousFacility),
                        amount: parseFloat(String(previousAmount)) || 0,
                    });
                }
            }
            this.knownParkingIds.clear();
            this.warnedDeadlineIds.clear();
            this.currentPaymentUrl = '';
            await this.setCapabilityValue('alarm_generic', false).catch(this.error);
            await this.setCapabilityValue('sesam_unpaid_amount', '0 kr').catch(this.error);
            await this.setCapabilityValue('sesam_hours_remaining', 'Ingen').catch(this.error);
            await this.setCapabilityValue('sesam_facility', 'Ingen').catch(this.error);
            await this.setCapabilityValue('sesam_payment_status', 'Betale').catch(this.error);
        }
        return result;
    }
};
