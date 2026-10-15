let input = '';
if (process.argv.includes('--closed-input')) {
  process.stdin.destroy();
  setTimeout(() => process.exit(0), 80);
} else {
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  if (request.fullPath === 'hold') {
    process.stdout.write(' ');
    setInterval(() => {}, 1000);
  } else if (request.fullPath === 'overflow')
    process.stdout.write('x'.repeat(100000));
  else if (request.fullPath === 'malformed')
    process.stdout.write(
      JSON.stringify({
        ok: true,
        result: {
          hasForm: false,
          text: '',
          formFieldCount: false,
          formFields: []
        }
      })
    );
  else {
    const text = `${process.cwd()}|${request.fullPath}|${request.includePageText}`;
    process.stdout.write(
      JSON.stringify({
        ok: true,
        result: {
          hasForm: true,
          text,
          formFieldCount: 1,
          formFields: [
            {
              pageNumber: 1,
              annotationIndex: 0,
              fieldKey: 'id:1',
              fieldName: 'name',
              fieldType: 'Tx',
              rect: [1, 2, 3, 4],
              values: [text],
              multiLine: false
            }
          ]
        }
      })
    );
  }
}
