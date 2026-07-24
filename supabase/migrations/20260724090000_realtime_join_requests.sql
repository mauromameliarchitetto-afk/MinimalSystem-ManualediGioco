-- Il Narratore deve sapere subito quando arriva una richiesta di ingresso in
-- una sua campagna, con un pop-up da Confermare/Rifiutare, invece di doverlo
-- scoprire aprendo a mano Account -> "Richieste in attesa". Serve Supabase
-- Realtime sugli INSERT di campaign_join_requests: di default una tabella
-- nuova non è nella pubblicazione usata dal client (supabase_realtime), va
-- aggiunta esplicitamente. La RLS già esistente ("richieste: richiedente o
-- narratore", is_campaign_master) continua a valere anche per gli eventi
-- realtime: un Narratore riceve solo le richieste delle proprie campagne.
alter publication supabase_realtime add table public.campaign_join_requests;
