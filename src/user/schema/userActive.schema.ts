import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type UserActiveDocument = HydratedDocument<UserActive>;

@Schema({
  timestamps: true,
})
export class UserActive {
  // One-to-many relationship with the User model
  @Prop()
  uid: Types.ObjectId;

  @Prop({ default: {}, type: SchemaTypes.Mixed })
  active: Record<string, any>;

  updatedAt?: Date;
  createdAt?: Date;
}

export const UserActiveSchema = SchemaFactory.createForClass(UserActive);
