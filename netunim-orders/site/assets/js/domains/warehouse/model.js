

export function warehouseStatusLabel(o){return({to_order:['להזמין','red'],ordered:['הוזמן','yellow'],direct:['הוזמן ישירות','yellow'],arrived:['הגיע','green'],picked:['נאסף','green']}[o.status]||['פתוח','yellow'])}
