import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

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

  @Prop({ default: 0 })
  money: number;

  @Prop({ default: '' })
  email: string;

  @Prop({ default: {}, type: SchemaTypes.Mixed })
  meta: Record<string, any>;

  @Prop({ default: false })
  isBaned: boolean;

  @Prop()
  server: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
