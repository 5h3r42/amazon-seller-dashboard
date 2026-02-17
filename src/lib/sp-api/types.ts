export type SpApiRegion = "na" | "eu" | "fe";

export interface SpApiRuntimeEnv {
  region: SpApiRegion;
  marketplaceId?: string;
  sellerId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  userAgent: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  roleArn?: string;
}

export interface SpApiConnectionConfig {
  connectionId?: string;
  region: SpApiRegion;
  marketplaceId: string;
  sellerId?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userAgent: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  roleArn?: string;
}

export interface FlattenedFinancialEvent {
  eventKey: string;
  postedDate: Date;
  eventType: string;
  amount: number;
  currency: string;
  amazonOrderId?: string;
  asin?: string;
  sku?: string;
  rawJson?: string;
}
