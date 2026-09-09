import Homey from 'homey';

module.exports = {

  /**
   * Henter status for alle registrerte kjøretøy.
   */
  async getStatus({ homey }: { homey: any }): Promise<any[]> {
    const driver = homey.drivers.getDriver('vehicle') as any;
    if (!driver) return [];

    const devices = driver.getDevices() as any[];
    const list = [];

    for (const d of devices) {
      list.push({
        id: d.getData().id,
        guid: d.id || d.getData().id,
        name: d.getName(),
        regNumber: d.getSetting('reg_number') || d.getData().regNumber,
        hasUnpaid: d.getCapabilityValue('alarm_generic') === true,
        amount: d.getCapabilityValue('sesam_unpaid_amount') || 0,
        facility: d.getCapabilityValue('sesam_facility') || 'Ingen',
        hoursRemaining: d.getCapabilityValue('sesam_hours_remaining') || 0,
        paymentUrl: d.getCapabilityValue('sesam_payment_url') || 'https://sesam-sesam.com/betal-for-parkering/',
      });
    }

    return list;
  },

  /**
   * Utfører en manuell sjekk for et spesifikt kjøretøy.
   */
  async syncVehicle({ homey, body }: { homey: any; body: { id: string } }): Promise<any> {
    const driver = homey.drivers.getDriver('vehicle') as any;
    if (!driver) throw new Error('Driver ikke funnet');

    const devices = driver.getDevices() as any[];
    const device = devices.find(d => d.getData().id === body.id || d.id === body.id);
    if (!device) throw new Error('Kjøretøy ikke funnet');

    const res = await device.syncUnpaidParking();
    return res;
  },

};
