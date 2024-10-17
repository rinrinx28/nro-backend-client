import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, Types } from 'mongoose';
import { Service } from 'src/service/schema/service.schema';
import { User } from './user.schema';

export type UserActiveDocument = HydratedDocument<UserActive>;

@Schema({
  timestamps: true,
})
export class UserActive {
  // One-to-many relationship with the User model
  @Prop({ type: [{ type: Types.ObjectId, ref: User.name }] })
  uid: Types.ObjectId;

  @Prop({ default: {} })
  active: Record<string, any>;

  updatedAt?: Date;
  createdAt?: Date;
}

export const UserActiveSchema = SchemaFactory.createForClass(UserActive);
