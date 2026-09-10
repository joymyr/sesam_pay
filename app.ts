'use strict';

import Homey from 'homey';

module.exports = class SesamPayApp extends Homey.App {

  private triggerUnpaidParkingFoundCard!: Homey.FlowCardTriggerDevice;
  private triggerDeadlineApproachingCard!: Homey.FlowCardTriggerDevice;
  private triggerParkingPaidCard!: Homey.FlowCardTriggerDevice;

  private triggerAnyUnpaidParkingFoundCard!: Homey.FlowCardTrigger;
  private triggerAnyDeadlineApproachingCard!: Homey.FlowCardTrigger;
  private triggerAnyParkingPaidCard!: Homey.FlowCardTrigger;

  async onInit(): Promise<void> {
    this.log('Sesam Pay app har blitt initialisert');

    this.registerFlowCards();
  }

  private registerFlowCards(): void {
    // 1. Enhetsspesifikke Triggere
    this.triggerUnpaidParkingFoundCard = this.homey.flow.getDeviceTriggerCard('unpaid_parking_found');
    this.triggerDeadlineApproachingCard = this.homey.flow.getDeviceTriggerCard('deadline_approaching');
    this.triggerParkingPaidCard = this.homey.flow.getDeviceTriggerCard('parking_paid');

    // 2. Generelle (App-nivå) Triggere
    this.triggerAnyUnpaidParkingFoundCard = this.homey.flow.getTriggerCard('any_unpaid_parking_found');
    this.triggerAnyDeadlineApproachingCard = this.homey.flow.getTriggerCard('any_deadline_approaching');
    this.triggerAnyParkingPaidCard = this.homey.flow.getTriggerCard('any_parking_paid');

    // 3. Conditions (Og...)
    this.homey.flow
      .getConditionCard('has_unpaid_parking')
      .registerRunListener(async (args) => {
        const device = args.device as any;
        return device.getCapabilityValue('alarm_generic') === true;
      });

    this.homey.flow
      .getConditionCard('any_has_unpaid_parking')
      .registerRunListener(async () => {
        const driver = this.homey.drivers.getDriver('vehicle') as any;
        if (!driver) return false;
        const devices = driver.getDevices() as any[];
        return devices.some(d => d.getCapabilityValue('alarm_generic') === true);
      });

    // 4. Actions (Så...)
    this.homey.flow
      .getActionCard('check_unpaid_now')
      .registerRunListener(async (args) => {
        const device = args.device as any;
        this.log(`Kjører manuell sjekk fra flow for ${device.getName()}`);
        await device.syncUnpaidParking();
        return true;
      });

    this.homey.flow
      .getActionCard('check_all_vehicles_now')
      .registerRunListener(async () => {
        this.log('Kjører manuell sjekk for alle kjøretøy fra flow');
        const driver = this.homey.drivers.getDriver('vehicle') as any;
        if (!driver) return true;
        const devices = driver.getDevices() as any[];
        for (const d of devices) {
          await d.syncUnpaidParking().catch(this.error);
        }
        return true;
      });

    this.homey.flow
      .getActionCard('send_timeline_notification')
      .registerRunListener(async (args) => {
        const device = args.device as any;
        this.log(`Sender tidslinjevarsel fra flow for ${device.getName()}`);
        await device.sendTimelineNotification();
        return true;
      });
  }

  /**
   * Hjelpemetode for å trigge "Ny ubetalt parkering oppdaget"
   */
  public async triggerUnpaidParkingFound(device: Homey.Device, tokens: {
    regnr: string;
    facility: string;
    amount: number;
    hours_remaining: number;
    deadline_str: string;
    formatted_message: string;
    payment_url: string;
    end_time: string;
  }): Promise<void> {
    const vehicleName = device.getName();
    this.log(`Trigger flow: unpaid_parking_found for ${tokens.regnr}`);
    await this.triggerUnpaidParkingFoundCard.trigger(device, tokens).catch(this.error);
    await this.triggerAnyUnpaidParkingFoundCard.trigger({
      ...tokens,
      vehicle_name: vehicleName,
    }).catch(this.error);
  }

  /**
   * Hjelpemetode for å trigge "Betalingsfrist utløper snart"
   */
  public async triggerDeadlineApproaching(device: Homey.Device, tokens: {
    regnr: string;
    facility: string;
    amount: number;
    hours_remaining: number;
    deadline_str: string;
    formatted_message: string;
    payment_url: string;
  }): Promise<void> {
    const vehicleName = device.getName();
    this.log(`Trigger flow: deadline_approaching for ${tokens.regnr}`);
    await this.triggerDeadlineApproachingCard.trigger(device, tokens).catch(this.error);
    await this.triggerAnyDeadlineApproachingCard.trigger({
      ...tokens,
      vehicle_name: vehicleName,
    }).catch(this.error);
  }

  /**
   * Hjelpemetode for å trigge "Parkering er betalt"
   */
  public async triggerParkingPaid(device: Homey.Device, tokens: {
    regnr: string;
    facility: string;
    amount: number;
  }): Promise<void> {
    const vehicleName = device.getName();
    this.log(`Trigger flow: parking_paid for ${tokens.regnr}`);
    await this.triggerParkingPaidCard.trigger(device, tokens).catch(this.error);
    await this.triggerAnyParkingPaidCard.trigger({
      ...tokens,
      vehicle_name: vehicleName,
    }).catch(this.error);
  }

};
