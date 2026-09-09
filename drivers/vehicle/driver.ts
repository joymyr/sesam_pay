import Homey from 'homey';
import { SesamClient } from '../../lib/SesamClient';

module.exports = class VehicleDriver extends Homey.Driver {

  async onInit(): Promise<void> {
    this.log('VehicleDriver har blitt initialisert');
  }

  async onPair(session: any): Promise<void> {
    session.setHandler('add_vehicle', async (data: {
      name: string;
      regNumber: string;
      pollInterval: number;
      email?: string;
    }) => {
      const cleanReg = data.regNumber.replace(/\s+/g, '').toUpperCase();
      if (!cleanReg || cleanReg.length < 2) {
        throw new Error('Vennligst oppgi et gyldig registreringsnummer.');
      }

      this.log(`Tester oppslag for ${cleanReg} under sammenkobling...`);
      // Utfør et sjekk-oppslag for å verifisere at Sesam-endepunktet svarer
      try {
        await SesamClient.checkUnpaid(cleanReg);
      } catch (err: any) {
        this.error(`Kunne ikke verifisere bil under paring: ${err.message}`);
        // Tillat likevel opprettelse dersom nettverk feilet midlertidig
      }

      const device = {
        name: data.name || cleanReg,
        data: {
          id: `sesam-vehicle-${cleanReg.toLowerCase()}`,
          regNumber: cleanReg,
        },
        settings: {
          reg_number: cleanReg,
          poll_interval: Number(data.pollInterval) || 30,
          email: data.email || '',
        },
      };

      return device;
    });
  }

  async onRepair(session: any, device: any): Promise<void> {
    session.setHandler('get_device_status', async () => {
      return {
        id: device.getData().id,
        name: device.getName(),
        regNumber: device.getSetting('reg_number') || device.getData().regNumber,
        hasUnpaid: device.getCapabilityValue('alarm_generic') === true,
        amount: device.getCapabilityValue('sesam_unpaid_amount') || 0,
        facility: device.getCapabilityValue('sesam_facility') || 'Ingen',
        hoursRemaining: device.getCapabilityValue('sesam_hours_remaining') || 0,
        paymentUrl: device.getCapabilityValue('sesam_payment_url') || 'https://sesam-sesam.com/betal-for-parkering/',
      };
    });
  }

};
