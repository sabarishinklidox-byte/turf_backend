export const sendSuccess = (
  response,
  { data, message = "Success", statusCode = 200, meta },
) =>
  response.status(statusCode).json({
    success: true,
    message,
    ...(data === undefined ? {} : { data }),
    ...(meta === undefined ? {} : { meta }),
    requestId: response.req.id,
  });
