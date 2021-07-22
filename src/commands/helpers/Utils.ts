export function getParams(): any {
  const args = process.argv.slice(2);
  let params = Object.create({});

  args.forEach(a => {
    const nameValue = a.split(" ");
    params[nameValue[0]] = nameValue[1];
  });

  return params;
}
