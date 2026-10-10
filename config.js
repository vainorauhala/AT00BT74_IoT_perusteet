// ASETUKSET 

const CONFIG = {


  // ThingSpeak tiedot
  CHANNEL_ID: "3502331",
  READ_API_KEY: "PT9GC80DSF4TXORJ",

  // Kenttien kartoitus.
  FIELDS: {
    temperature: "field1", // °C, DHT22
    humidity: "field2",    // %, DHT22
    water: "field3",       // %, VMA303 (vedenpinta / kosteus)
  },

  // Kuinka usein data haetaan
  POLL_INTERVAL_MS: 15000,
  STALE_AFTER_MS: 120000,
  DEFAULT_RESULTS: 100,

  // Hälyrajat
  THRESHOLDS: {
    temperature: { min: 5, max: 35 },
    humidity: { max: 70 },
    water: { max: 20000 }, // % — VMA303-lukema
  },
};
