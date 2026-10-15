// A controlled native child: no installed Everything process or user files.
process.send?.({kind:'ready'});
process.once('message',message=>{
 if(message?.kind!=='finish')process.exit(2);
 process.stdout.write(String(message.stdout??''),()=>{process.disconnect();});
});
