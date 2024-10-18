import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

@Schema({
  timestamps: true,
})
export class Message {
  @Prop()
  uid: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  meta: Record<string, any>;

  @Prop()
  content: string;

  @Prop()
  server: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
