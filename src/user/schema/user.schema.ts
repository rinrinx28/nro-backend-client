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

  @Prop({ default: 0 })
  diamon: number;

  @Prop({ default: '' })
  email: string;

  @Prop({ default: '0' })
  role: string;

  @Prop({
    default: {
      totalTrade: 0,
      limitTrade: 0,
      trade: 0,
      deposit: 0,
      withdraw: 0,
      totalScore: 0,
      avatar: null,
      vip: 0,
      vipStartDate: null,
      vipExpiryDate: null,
      rewardCollected: false,
      rewardDayCollected: [],
    },
    type: SchemaTypes.Mixed,
  })
  meta: Record<string, any>;

  @Prop({ default: false })
  isBaned: boolean;

  @Prop()
  server: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
