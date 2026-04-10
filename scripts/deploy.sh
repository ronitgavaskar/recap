#!/usr/bin/env bash
set -euo pipefail

FUNCTION_NAME="recap-standup"
RUNTIME="nodejs20.x"
HANDLER="dist/lambda.handler"
TIMEOUT=60
MEMORY=256
ZIP_FILE="recap-lambda.zip"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env vars from .env
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "Error: .env file not found at $PROJECT_ROOT/.env"
  exit 1
fi

source_env() {
  while IFS= read -r line || [ -n "$line" ]; do
    # skip blank lines and comments
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    # strip surrounding quotes and whitespace
    value="${value%\"}"
    value="${value#\"}"
    value="${value%"${value##*[![:space:]]}"}"
    [[ -n "$key" && -n "$value" ]] && export "$key=$value"
  done < "$PROJECT_ROOT/.env"
}
source_env

for var in GITHUB_TOKEN ANTHROPIC_API_KEY GITHUB_USERNAME; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set in .env"
    exit 1
  fi
done

# Build TypeScript
echo "Building TypeScript..."
cd "$PROJECT_ROOT"
npx tsc

# Package zip
echo "Packaging Lambda..."
rm -f "$ZIP_FILE"
zip -qr "$ZIP_FILE" dist/ node_modules/ package.json

echo "Zip size: $(du -h "$ZIP_FILE" | cut -f1)"

# Build environment variables as JSON
ENV_JSON="{\"Variables\":{\"GITHUB_TOKEN\":\"${GITHUB_TOKEN}\",\"ANTHROPIC_API_KEY\":\"${ANTHROPIC_API_KEY}\",\"GITHUB_USERNAME\":\"${GITHUB_USERNAME}\""
if [ -n "${SES_SENDER_EMAIL:-}" ]; then
  ENV_JSON="${ENV_JSON},\"SES_SENDER_EMAIL\":\"${SES_SENDER_EMAIL}\""
fi
if [ -n "${SES_RECIPIENT_EMAIL:-}" ]; then
  ENV_JSON="${ENV_JSON},\"SES_RECIPIENT_EMAIL\":\"${SES_RECIPIENT_EMAIL}\""
fi
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  ENV_JSON="${ENV_JSON},\"SLACK_WEBHOOK_URL\":\"${SLACK_WEBHOOK_URL}\""
fi
ENV_JSON="${ENV_JSON}}}"

if aws lambda get-function --function-name "$FUNCTION_NAME" > /dev/null 2>&1; then
  echo "Updating existing Lambda function..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --no-cli-pager

  # Wait for the update to complete before updating config
  aws lambda wait function-updated --function-name "$FUNCTION_NAME"

  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler "$HANDLER" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY" \
    --environment "$ENV_JSON" \
    --no-cli-pager
else
  echo "Creating new Lambda function..."

  if [ -z "${LAMBDA_ROLE_ARN:-}" ]; then
    echo "Error: LAMBDA_ROLE_ARN must be set in .env for first-time creation."
    echo "Example: LAMBDA_ROLE_ARN=arn:aws:iam::123456789:role/lambda-execution-role"
    exit 1
  fi

  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler "$HANDLER" \
    --role "$LAMBDA_ROLE_ARN" \
    --zip-file "fileb://$ZIP_FILE" \
    --timeout "$TIMEOUT" \
    --memory-size "$MEMORY" \
    --environment "$ENV_JSON" \
    --no-cli-pager
fi

rm -f "$ZIP_FILE"
echo "Done. Lambda function '$FUNCTION_NAME' is ready."
