export function formatMoney(amount: number, currencyName: string, symbol?: string): string {
  const absolute = Math.abs(amount).toLocaleString("en");
  const signed = amount < 0 ? `−${absolute}` : absolute;
  return symbol === undefined ? `${signed} ${currencyName}` : `${symbol}${signed}`;
}
