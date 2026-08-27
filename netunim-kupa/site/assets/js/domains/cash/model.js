import {num} from '../../core/money.js';

export function cashBalanceData(state){return state.cash.reduce((a,x)=>a+num(x.amount),0)}
