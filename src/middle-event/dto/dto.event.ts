export type BotMoney = '1' | '2';

export interface BotStatuEvent {
  id: string;
  uuid: string;
  name: string;
  map: string;
  zone: string;
  type_money: BotMoney;
  money: number;
  server: string;
}

export interface NoticeInfoEvent {
  uuid: string;
  content: string;
  server: string;
}

export type ServiceType = '0' | '1' | '2';

export interface ServiceEvent {
  uuid: string;
  type: ServiceType;
  bot_id: string;
  player_id: string;
  player_name?: string;
  service_id?: string;
  money_last?: number;
  money_current?: number;
  money_trade?: number;
  money_recevie?: number;
  server: string;
}
