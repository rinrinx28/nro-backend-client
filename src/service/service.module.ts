import { Module } from '@nestjs/common';
import { ServiceService } from './service.service';
import { Service, ServiceSchema } from './schema/service.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/user/schema/user.schema';
import {
  UserActive,
  UserActiveSchema,
} from 'src/user/schema/userActive.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Service.name, schema: ServiceSchema },
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: UserActive.name,
        schema: UserActiveSchema,
      },
    ]),
  ],
  providers: [ServiceService],
})
export class ServiceModule {}
