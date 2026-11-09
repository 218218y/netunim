import {supabaseConfig} from '../supabase/config.js';
import {mountAccountSecurity} from './js/shared/account-security-page.js';
mountAccountSecurity(document.getElementById('accountSecurity'),supabaseConfig);
