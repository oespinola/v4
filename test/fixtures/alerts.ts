// Formato real de las alertas del grupo (capturas del 5 al 8 de octubre de 2026), reducido
// al título y las líneas de datos: sin la descripción del servicio, IDs, teléfonos ni nombres.
const alert = (title: string, entry: string, obj: string, sl: string, risk: string) =>
  `*${title} - ALERTA DE TRADING*\nCoinMarketCap #1\nCrypto+ / Invasión Crypto\nAlerta #1\n\nDescripción.\n\nEntrada: ${entry} usd\nObj.: ${obj}\nSL: ${sl} usd\n${risk}`;

export const alerts = {
  // Cris (15/10): objetivo con un cero de menos (0.0798 por 0.00798), del lado equivocado
  alt: alert('ALT', '0.00812', 'ASL21, EMA55 y 0.0798 usd', '0.00838', 'Riesgo Alto 🔴'),
  // grupo de prueba (10/10): LONG con el objetivo por debajo de la Entrada, misma escala
  link: alert('LINK', '12.8', 'ASL21, EMA55 y 12 usd', '12.4', 'Riesgo Alto 🔴'),
  // Tomy: objetivo con precio numérico
  kaia: alert('KAIA', '0.0402', 'ASL21, EMA55 y 0.0380 usd', '0.0414', 'Riesgo Alto 🔴'),
  kite: alert('KITE', '0.1355', 'ASL21, EMA55 y 0.1459 usd', '0.1298', 'Riesgo Alto 🔴'),
  eth: alert('ETH', '2500', 'ASL21, EMA55 y 2577.29 usd', '2400', 'Riesgo Alto 🔴'),
  zec: alert('ZEC', '1202.96', 'ASL21, EMA55 y 1293.4 usd', '1161.2', 'Riesgo Alto 🔴'),
  // Cris: objetivo solo por indicadores, con espacio al final
  flux: alert('FLUX', '0.0822', 'ASL21, EMA55 ', '0.0847', 'Riesgo medio 🟡'),
  coti: alert('COTI', '0.01444', 'ASL21, EMA55 ', '0.01467', 'Riesgo medio-alto 🟠'),
  axs: alert('AXS', '1.246', 'ASL21, EMA55 ', '1.222', 'Riesgo ALTO 🟣'),
  bera: alert('BERA', '0.2299', 'ASL21, EMA55 ', '0.2337', 'Riesgo medio 🟡'), // 13/10: Demo la rechazó (-4014)
  g: alert('G', '0.00407', 'ASL21, EMA55 ', '0.00392', 'Riesgo medio 🟡'),
  bananas31: alert('BANANAS31', '0.006633', 'ASL21, EMA55 ', '0.006431', 'Riesgo medio 🟡'),
};

// Imagen sintética para los tests de extracción: el extractor es un fake, así que el
// contenido no importa. Las capturas reales (../AlertsSamples) quedan fuera del repo.
export const fakeImage = Buffer.from('imagen-de-prueba');
