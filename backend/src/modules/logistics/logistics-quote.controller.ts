import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { ListQuotesInput, LogisticsQuoteService, SubmitQuoteInput, UpdateQuoteInput } from "./logistics-quote.service";

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.get("user-agent") };
}

export class LogisticsQuoteController {
  constructor(private readonly quotes: LogisticsQuoteService) {}

  submitQuote = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const input = req.body as SubmitQuoteInput;
    const result = await this.quotes.submitQuote(user, publicId, input, requestMeta(req));
    sendSuccess(res, result, "Quote submitted successfully", 201);
  };

  listQuotesForRequest = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const query = req.validatedQuery as ListQuotesInput;
    const result = await this.quotes.listQuotesForRequest(user, publicId, query);
    sendSuccess(res, result);
  };

  listMyQuotes = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const query = req.validatedQuery as ListQuotesInput;
    const result = await this.quotes.listMyQuotes(user, query);
    sendSuccess(res, result);
  };

  getQuote = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.quotes.getQuote(user, publicId);
    sendSuccess(res, result);
  };

  updateQuote = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const input = req.body as UpdateQuoteInput;
    const result = await this.quotes.updateQuote(user, publicId, input, requestMeta(req));
    sendSuccess(res, result, "Quote updated successfully");
  };

  withdrawQuote = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.quotes.withdrawQuote(user, publicId, requestMeta(req));
    sendSuccess(res, result, "Quote withdrawn successfully");
  };

  acceptQuote = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.quotes.acceptQuote(user, publicId, requestMeta(req));
    sendSuccess(res, result, "Quote accepted successfully");
  };

  rejectQuote = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.quotes.rejectQuote(user, publicId, requestMeta(req));
    sendSuccess(res, result, "Quote rejected successfully");
  };
}
