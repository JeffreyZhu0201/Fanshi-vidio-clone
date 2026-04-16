export const healthCheck = async (_request, response) => {
  response.status(200).json({
    success: true,
    service: 'backend',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
};

