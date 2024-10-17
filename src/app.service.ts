import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  hexToString(hex: any): string {
    try {
      // Remove any spaces or other non-hex characters
      const cleanedHex = hex.replace(/\s/g, '');
      // Convert to bytes and then decode as UTF-8
      const utf8String = Buffer.from(cleanedHex, 'hex').toString('utf8');
      return utf8String;
    } catch (error) {
      return 'Invalid hexadecimal input.';
    }
  }
}
