import { Module } from '@nestjs/common';
import { ServiceService } from './service.service';

@Module({
  providers: [ServiceService]
})
export class ServiceModule {}
