import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type ClanDocument = HydratedDocument<Clan>;

@Schema({
  timestamps: true,
})
export class Clan {
  @Prop()
  ownerId: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  meta: Record<string, any>;

  @Prop()
  member: number;

  @Prop({ default: 0 })
  score: number;

  updatedAt?: Date;
  createdAt?: Date;
}

export const ClanSchema = SchemaFactory.createForClass(Clan);
