declare module 'qrcode' {
  type Level = 'L' | 'M' | 'Q' | 'H';
  const QRCode: {
    create(text: string, opts?: { errorCorrectionLevel?: Level }): { modules: { size: number; get(row: number, col: number): number | boolean } };
    toDataURL(text: string, opts?: { errorCorrectionLevel?: Level; margin?: number; width?: number }): Promise<string>;
  };
  export default QRCode;
}
