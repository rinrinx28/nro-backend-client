import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, Types } from 'mongoose';
import { Service } from 'src/service/schema/service.schema';
import { UserActive } from './userActive.schema';

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: true,
})
export class User {
  @Prop({ unique: true })
  username: string;

  @Prop({ unique: true })
  name: string;

  @Prop()
  pwd_h: string;

  @Prop()
  money: number;

  @Prop()
  email: string;

  @Prop({ default: {} })
  meta: Record<string, any>;

  @Prop()
  server: string;

  // One-to-many relationship with the Service model
  @Prop({ type: [{ type: Types.ObjectId, ref: Service.name }] })
  services: Types.ObjectId[]; // An array of Service ObjectIds

  // One-to-many relationship with the UserActive model
  @Prop({ type: [{ type: Types.ObjectId, ref: UserActive.name }] })
  userActives: Types.ObjectId[]; // An array of UserActive ObjectIds

  updatedAt?: Date;
  createdAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
