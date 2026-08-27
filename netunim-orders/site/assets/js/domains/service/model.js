

export function serviceStatus(c){if(c.closed)return{key:'closed',text:'נסגר',cls:'green'};if(c.escalated)return{key:'escalated',text:'הוקפץ',cls:'red'};if(c.sent)return{key:'sent',text:'נשלח',cls:'green'};if(c.followUp)return{key:'follow',text:'במעקב',cls:'yellow'};return{key:'open',text:'פתוח',cls:'yellow'}}

export function serviceEmailValue(value){const text=String(value??'').trim();return text||'—'}
