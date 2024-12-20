// sessionModel.ts

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

@Schema({
  timestamps: true,
})
export class Session {
  @Prop({ type: String, required: true })
  server: string;

  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: Number, required: true })
  result: number; // Kết quả cuối cùng

  @Prop({ type: [String], required: true })
  numbers: string[]; // Dãy số

  @Prop({ type: Number, required: true })
  remainingTime: number; // Thời gian còn lại

  @Prop({ type: SchemaTypes.Date })
  receivedAt: Date; // Thời gian nhận dữ liệu

  @Prop({ default: false })
  isEnd: boolean;

  updatedAt?: Date;
  createdAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
