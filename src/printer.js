// Printer driver. Mock for now; replace start() with the real LAN (MQTT + FTPS) code
// once we've confirmed the P1S/P2S accept it (needs ip, serial, access_code per printer).
module.exports = {
  async start(printer, job) {
    console.log(`[mock] start job ${job.id} (${job.file_name}) on ${printer.name}`);
    return true;
  },
};
