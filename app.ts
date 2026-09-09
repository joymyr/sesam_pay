'use strict';

import Homey from 'homey';

module.exports = class SesamPayApp extends Homey.App {

  private triggerUnpaidParkingFoundCard!: Homey.FlowCardTriggerDevice;
  private triggerDeadlineApproachingCard!: Homey.FlowCardTriggerDevice;
  private triggerParkingPaidCard!: Homey.FlowCardTriggerDevice;

  async onInit(): Promise<void> {
    this.log('Sesam Pay app har blitt initialisert');

    this.registerFlowCards();
  }

  private registerFlowCards(): void {
    // 1. Triggere
    this.triggerUnpaidParkingFoundCard = this.homey.flow.getDeviceTriggerCard('unpaid_parking_found');
    this.triggerDeadlineApproachingCard = this.homey.flow.getDeviceTriggerCard('deadline_approaching');
    this.triggerParkingPaidCard = this.homey.flow.getDeviceTriggerCard('parking_paid');

    // 2. Conditions (Og...)
    this.homey.flow
      .getConditionCard('has_unpaid_parking')
      .registerRunListener(async (args, state) => {
        const device = args.device as any;
        return device.getCapabilityValue('alarm_generic') === true;
      });

    // 3. Actions (Så...)
    this.homey.flow
      .getActionCard('check_unpaid_now')
      .registerRunListener(async (args, state) => {
        const device = args.device as any;
        this.log(`Kjører manuell sjekk fra flow for ${device.getName()}`);
        await device.syncUnpaidParking();
        return true;
      });

    this.homey.flow
      .getActionCard('send_timeline_notification')
      .registerRunListener(async (args, state) => {
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
    this.log(`Trigger flow: unpaid_parking_found for ${tokens.regnr}`);
    await this.triggerUnpaidParkingFoundCard.trigger(device, tokens).catch(this.error);
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
    this.log(`Trigger flow: deadline_approaching for ${tokens.regnr}`);
    await this.triggerDeadlineApproachingCard.trigger(device, tokens).catch(this.error);
  }

  /**
   * Hjelpemetode for å trigge "Parkering er betalt"
   */
  public async triggerParkingPaid(device: Homey.Device, tokens: {
    regnr: string;
    facility: string;
    amount: number;
  }): Promise<void> {
    this.log(`Trigger flow: parking_paid for ${tokens.regnr}`);
    await this.triggerParkingPaidCard.trigger(device, tokens).catch(this.error);
  }

};
