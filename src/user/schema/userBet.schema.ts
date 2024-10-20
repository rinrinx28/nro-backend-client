import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes } from 'mongoose';

export type UserBetDocument = HydratedDocument<UserBet>;

export type typePlace =
  | 'C'
  | 'L'
  | 'T'
  | 'X'
  | 'CT'
  | 'CX'
  | 'LT'
  | 'LX'
  | string;

export type typeBet = 'cl' | 'g' | 'x';

@Schema({
  timestamps: true,
})
export class UserBet {
  @Prop({ default: {}, type: SchemaTypes.Mixed })
  meta: Record<string, any>;

  @Prop()
  betId: string;

  @Prop()
  uid: string;

  @Prop()
  amount: number;

  @Prop({ default: 0 })
  revice: number;

  @Prop()
  place: typePlace;

  @Prop()
  typeBet: typeBet;

  @Prop({ default: false })
  isEnd: boolean;

  @Prop({ default: 0 })
  status: number;

  @Prop({ default: '' })
  result: string;

  @Prop()
  server: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const UserBetSchema = SchemaFactory.createForClass(UserBet);
