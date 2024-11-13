import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  hexToString(hex: any): string {
    try {
      const bytes = hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16));
      if (!bytes) return '';
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch (error) {
      return 'Invalid hexadecimal input.';
    }
  }
}
