declare module 'qrcode' {
  const QRCode: {
    create(text: string, opts?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): { modules: { size: number; get(row: number, col: number): number | boolean } };
  };
  export default QRCode;
}
