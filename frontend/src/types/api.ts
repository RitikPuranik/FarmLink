export type UserRole =
  | "FARMER"
  | "FPO_ADMIN"
  | "BUYER"
  | "TRANSPORTER"
  | "WAREHOUSE_OPERATOR"
  | "ADMIN"
  | "GOVERNMENT_VIEWER";

export type AccountStatus = "ACTIVE" | "PENDING_VERIFICATION" | "SUSPENDED" | "DEACTIVATED";
export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED";
export type Language = "en" | "hi" | "mr";

export interface AuthUser {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  preferredLanguage: Language;
  verification: {
    phone: VerificationStatus;
    email: VerificationStatus;
    identity: VerificationStatus;
  };
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export class ApiRequestError extends Error {
  code: string;
  fields?: Record<string, string>;
  status: number;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
