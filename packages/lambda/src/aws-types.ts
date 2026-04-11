/**
 * Minimal structural types for the AWS Lambda event shapes we support.
 *
 * We deliberately inline these rather than depending on `@types/aws-lambda`
 * to keep `@triad/lambda` zero-dependency at build time and avoid bloating
 * the user's Lambda bundle. The fields here are a strict subset of the
 * real types — enough to parse incoming requests and emit correct
 * responses across API Gateway v1, API Gateway v2 (HTTP API),
 * Lambda Function URLs (which use the v2 shape), and ALB targets.
 *
 * Reference: https://docs.aws.amazon.com/lambda/latest/dg/lambda-services.html
 */

/** Shared Lambda invocation context (subset). */
export interface LambdaContext {
  readonly awsRequestId: string;
  readonly functionName: string;
  readonly functionVersion: string;
  readonly invokedFunctionArn: string;
  readonly memoryLimitInMB: string;
  readonly logGroupName: string;
  readonly logStreamName: string;
  readonly getRemainingTimeInMillis: () => number;
}

// ---------------------------------------------------------------------------
// API Gateway v1 (REST API) / ALB — both use a v1-ish shape with some
// differences around `requestContext` and the presence of `elb`.
// ---------------------------------------------------------------------------

export interface APIGatewayProxyEventV1 {
  readonly version?: undefined;
  readonly httpMethod: string;
  readonly path: string;
  readonly resource?: string;
  readonly headers: Record<string, string | undefined> | null;
  readonly multiValueHeaders?: Record<string, string[] | undefined> | null;
  readonly queryStringParameters: Record<string, string | undefined> | null;
  readonly multiValueQueryStringParameters?: Record<
    string,
    string[] | undefined
  > | null;
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly body: string | null;
  readonly isBase64Encoded: boolean;
  readonly requestContext?: {
    readonly elb?: { readonly targetGroupArn: string };
    readonly httpMethod?: string;
    readonly path?: string;
  };
}

export interface APIGatewayProxyResultV1 {
  statusCode: number;
  headers?: Record<string, boolean | number | string>;
  multiValueHeaders?: Record<string, Array<boolean | number | string>>;
  body: string;
  isBase64Encoded?: boolean;
}

// ---------------------------------------------------------------------------
// API Gateway v2 (HTTP API) + Lambda Function URL
// ---------------------------------------------------------------------------

export interface APIGatewayProxyEventV2 {
  readonly version: '2.0';
  readonly routeKey?: string;
  readonly rawPath: string;
  readonly rawQueryString: string;
  readonly cookies?: string[];
  readonly headers: Record<string, string | undefined>;
  readonly queryStringParameters?: Record<string, string | undefined>;
  readonly pathParameters?: Record<string, string | undefined>;
  readonly body?: string;
  readonly isBase64Encoded: boolean;
  readonly requestContext: {
    readonly http: {
      readonly method: string;
      readonly path: string;
      readonly protocol: string;
      readonly sourceIp: string;
      readonly userAgent: string;
    };
  };
}

export interface APIGatewayProxyResultV2 {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
}

// ---------------------------------------------------------------------------
// Unions used by the public handler signature.
// ---------------------------------------------------------------------------

export type LambdaEvent = APIGatewayProxyEventV1 | APIGatewayProxyEventV2;
export type LambdaResult = APIGatewayProxyResultV1 | APIGatewayProxyResultV2;
