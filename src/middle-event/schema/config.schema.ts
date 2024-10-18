import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type EConfigDocument = HydratedDocument<EConfig>;

@Schema({
  timestamps: true,
})
export class EConfig {
  @Prop()
  name: string;

  @Prop()
  description: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  option: Record<string, any>;

  @Prop({ default: true })
  isEnable: boolean;

  updatedAt?: Date;
  createdAt?: Date;
}

export const EConfigSchema = SchemaFactory.createForClass(EConfig);
