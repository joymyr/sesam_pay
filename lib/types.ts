export interface UnpaidParkingItem {
  id: string;
  facility: string;
  owner?: string;
  startTime: Date | null;
  endTime: Date | null;
  startTimeStr?: string;
  endTimeStr?: string;
  durationStr?: string;
  amount: number;
  currency: string;
  deadline: Date | null;
  hoursRemaining?: number;
}

export interface CheckUnpaidResult {
  regNumber: string;
  hasUnpaid: boolean;
  totalAmount: number;
  currency: string;
  parkings: UnpaidParkingItem[];
  checkedAt: Date;
  rawHtml?: string;
}

export interface PaymentUrlResult {
  paymentId: string;
  redirectUrl: string;
}
