/**
 * Request validation and error handling middleware
 */

// Standardized error response
function sendError(res, statusCode, errorCode, message) {
  res.status(statusCode).json({
    error: message,
    code: errorCode,
    status: statusCode,
    timestamp: new Date().toISOString(),
  });
}

// Validation middleware for signup/login
function validateAuthRequest(req, res, next) {
  const { email, password, company_name } = req.body;

  // Email validation
  if (!email || typeof email !== "string" || email.trim() === "") {
    return sendError(res, 400, "INVALID_EMAIL", "Email is required");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return sendError(res, 400, "INVALID_EMAIL", "Email format is invalid");
  }

  if (email.length > 255) {
    return sendError(res, 400, "INVALID_EMAIL", "Email is too long (max 255 chars)");
  }

  // Password validation
  if (!password || typeof password !== "string" || password.trim() === "") {
    return sendError(res, 400, "INVALID_PASSWORD", "Password is required");
  }

  if (password.length < 6) {
    return sendError(res, 400, "INVALID_PASSWORD", "Password must be at least 6 characters");
  }

  if (password.length > 255) {
    return sendError(res, 400, "INVALID_PASSWORD", "Password is too long");
  }

  // Company name validation (optional but sanitize if provided)
  if (company_name !== undefined) {
    if (typeof company_name !== "string") {
      return sendError(res, 400, "INVALID_COMPANY_NAME", "Company name must be a string");
    }
    if (company_name.length > 255) {
      return sendError(res, 400, "INVALID_COMPANY_NAME", "Company name is too long (max 255 chars)");
    }
  }

  next();
}

// Validation middleware for evaluation requests
function validateEvaluationRequest(req, res, next) {
  const { handle, platform, category, email } = req.body;

  // Handle validation
  if (!handle || typeof handle !== "string" || handle.trim() === "") {
    return sendError(res, 400, "INVALID_HANDLE", "Handle is required");
  }

  if (handle.length > 100) {
    return sendError(res, 400, "INVALID_HANDLE", "Handle is too long (max 100 chars)");
  }

  // Platform validation
  if (!platform || typeof platform !== "string" || platform.trim() === "") {
    return sendError(res, 400, "INVALID_PLATFORM", "Platform is required");
  }

  const validPlatforms = ["twitter", "x", "instagram", "ig", "tiktok"];
  if (!validPlatforms.includes(platform.toLowerCase())) {
    return sendError(
      res,
      400,
      "INVALID_PLATFORM",
      `Platform must be one of: ${validPlatforms.join(", ")}`
    );
  }

  // Category validation
  if (!category || typeof category !== "string" || category.trim() === "") {
    return sendError(res, 400, "INVALID_CATEGORY", "Category is required");
  }

  if (category.length > 100) {
    return sendError(res, 400, "INVALID_CATEGORY", "Category is too long (max 100 chars)");
  }

  // Email validation (optional but validate if provided)
  if (email !== undefined) {
    if (typeof email !== "string") {
      return sendError(res, 400, "INVALID_EMAIL", "Email must be a string");
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      return sendError(res, 400, "INVALID_EMAIL", "Email format is invalid");
    }
  }

  next();
}

// Validation middleware for subscription requests
function validateSubscriptionRequest(req, res, next) {
  const { tier, billingCycle } = req.body;

  // Tier validation
  if (!tier || typeof tier !== "string" || tier.trim() === "") {
    return sendError(res, 400, "INVALID_TIER", "Tier is required");
  }

  // Only tiers whose pipeline actually exists can be bought. Pro (multi-platform)
  // and the business tiers unlock via env flags once they deliver what they promise.
  const validTiers = ["social_snapshot", "growth_plan",
    ...(process.env.ENABLE_GROWTH_PLAN_PRO === "true" ? ["growth_plan_pro"] : []),
    ...(process.env.ENABLE_BUSINESS_CHECKOUT === "true" ? ["business_growth", "business_evaluator", "agency"] : [])];
  if (!validTiers.includes(tier)) {
    return sendError(
      res,
      400,
      "INVALID_TIER",
      `Tier must be one of: ${validTiers.join(", ")}`
    );
  }

  // Billing cycle validation
  if (billingCycle !== undefined) {
    if (typeof billingCycle !== "string") {
      return sendError(res, 400, "INVALID_BILLING_CYCLE", "Billing cycle must be a string");
    }
    const validCycles = ["monthly", "annual"];
    if (!validCycles.includes(billingCycle)) {
      return sendError(
        res,
        400,
        "INVALID_BILLING_CYCLE",
        `Billing cycle must be one of: ${validCycles.join(", ")}`
      );
    }
  }

  next();
}

// Global error handler (catches unhandled errors)
function errorHandler(err, req, res, next) {
  console.error("[Error Handler]", err.message);

  // Default to 500
  const statusCode = err.status || 500;
  const errorCode = err.code || "INTERNAL_ERROR";
  const message = err.message || "An unexpected error occurred";

  sendError(res, statusCode, errorCode, message);
}

module.exports = {
  sendError,
  validateAuthRequest,
  validateEvaluationRequest,
  validateSubscriptionRequest,
  errorHandler,
};
