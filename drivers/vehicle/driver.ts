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
    this.log(`onRepair startet for enhet: ${device.getName()}`);

    const getStatusObj = () => {
      try {
        const data = (typeof device.getData === 'function' ? device.getData() : null) || {};
        const regNumber = (typeof device.getSetting === 'function' ? device.getSetting('reg_number') : null) || data.regNumber || '';
        const hasUnpaid = device.getCapabilityValue('alarm_generic') === true;
        
        const rawAmount = String(device.getCapabilityValue('sesam_unpaid_amount') || '0').replace(/[^\d.,]/g, '').replace(',', '.');
        const amount = parseFloat(rawAmount) || 0;
        
        const facility = String(device.getCapabilityValue('sesam_facility') || 'Ingen');
        
        const rawHours = String(device.getCapabilityValue('sesam_hours_remaining') || '0').replace(/[^\d.,]/g, '').replace(',', '.');
        const hoursRemaining = parseFloat(rawHours) || 0;
        
        const paymentUrl = (device as any).currentPaymentUrl || 'https://sesam-sesam.com/betal-for-parkering/';
        const parkings = (device as any).currentParkings || [];

        return {
          id: data.id || device.id || regNumber,
          name: device.getName() || regNumber,
          regNumber,
          hasUnpaid,
          amount,
          facility,
          hoursRemaining,
          paymentUrl,
          parkings,
        };
      } catch (err: any) {
        this.error(`Feil under henting av statusobjekt i onRepair: ${err.message}`);
        return {
          id: device.id || 'unknown',
          name: device.getName() || 'Kjøretøy',
          regNumber: '',
          hasUnpaid: false,
          amount: 0,
          facility: 'Ingen',
          hoursRemaining: 0,
          paymentUrl: 'https://sesam-sesam.com/betal-for-parkering/',
          parkings: [],
        };
      }
    };

    session.setHandler('get_status', async (data: any) => {
      this.log(`Repair handler get_status kalt for ${device.getName()}`);
      const status = getStatusObj();
      this.log(`Repair get_status returnerer: ${JSON.stringify(status)}`);
      return status;
    });

    session.setHandler('get_device_status', async (data: any) => {
      this.log(`Repair handler get_device_status kalt for ${device.getName()}`);
      const status = getStatusObj();
      this.log(`Repair get_device_status returnerer: ${JSON.stringify(status)}`);
      return status;
    });

    session.setHandler('sync_device', async (data: any) => {
      this.log(`Repair handler sync_device kalt for ${device.getName()}`);
      await device.syncUnpaidParking();
      const status = getStatusObj();
      this.log(`Repair sync_device fullført: ${JSON.stringify(status)}`);
      return status;
    });

    // Send status automatisk til webviewet etter at økten har startet
    [200, 600, 1200, 2500].forEach((delay) => {
      this.homey.setTimeout(() => {
        try {
          session.emit('status', getStatusObj());
        } catch (e) {}
      }, delay);
    });
  }

};
