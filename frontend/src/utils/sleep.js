const sleep = (duration) => {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
};

export { sleep };
