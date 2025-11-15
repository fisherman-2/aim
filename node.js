	(function(){
		// Initialize ELO in localStorage
		const MIN_ELO = 1000;
		const K = 32;
		const K_ROUND = 20; // per-round K for showing round-by-round elo changes
		const GRANDCHAMP_THRESHOLD = 3000; // ELO at/above this becomes Grandchamp (no subdivisions)

		function getElo(){
			const v = localStorage.getItem('elo');
			return v ? parseInt(v,10) : MIN_ELO;
		}

		function setElo(n){
			n = Math.max(MIN_ELO, Math.round(n));
			localStorage.setItem('elo', n);
			updateEloUI();
		}

		function eloToRank(elo){
			// Grandchamp is a special top tier with no subdivisions
			if(elo >= GRANDCHAMP_THRESHOLD){
				return {tier: 'Grand Champion', division: null, name: 'Grand Champion', img: 'img/emblems/grandchamp.png'};
			}
			const idx = Math.max(0, Math.floor((elo - MIN_ELO) / 100));
			const clamped = Math.min(15, idx);
			const tierNames = ['Bronze','Silver','Gold','Champion'];
			const tierIndex = Math.min(Math.floor(clamped / 4), tierNames.length - 1);
			const within = clamped % 4; // 0..3 where 0 is lowest (1)
			const division = within + 1; // 1,2,3,4 (1 is lowest)
			const tier = tierNames[tierIndex] || 'Champion';
			return {tier, division, name: `${tier} ${division}`, img:`img/emblems/${tier.toLowerCase()}${division}.png`};
		}

		// UI elements
		const eloDisplay = document.getElementById('eloDisplay');
		const rankDisplay = document.getElementById('rankDisplay');
		const emblem = document.getElementById('emblem');
		const queueBtn = document.getElementById('queueBtn');
		const arena = document.getElementById('arena');
		const log = document.getElementById('log');
		const roundNum = document.getElementById('roundNum');
		const timeLeft = document.getElementById('timeLeft');
		const botEloEl = document.getElementById('botElo');
		const botNameEl = document.getElementById('botName');
		const resultBox = document.getElementById('resultBox');

		function updateEloUI(){
			const e = getElo();
			eloDisplay.textContent = e;
			const r = eloToRank(e);
			rankDisplay.textContent = r.name;
			emblem.src = r.img;
			emblem.onerror = ()=>{ emblem.src = 'img/emblems/bronze4.png'; };
		}

		updateEloUI();

		// Game state
		let currentBotElo = null;
		let currentBotName = null;
		let rounds = 3;
		let currentRound = 0;
		let playerWins = 0;
		let roundHistory = [];

		function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

		function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

		function pickBotElo(playerElo){
			const diff = randInt(-150,150);
			return Math.max(MIN_ELO, playerElo + diff);
		}

		// countdown before match
		const countdownEl = document.getElementById('countdown');
		async function doCountdown(seconds){
			countdownEl.style.opacity = '1';
			countdownEl.style.pointerEvents = 'none';
			for(let i=seconds;i>0;i--){
				countdownEl.textContent = i;
				await new Promise(s=>setTimeout(s,1000));
			}
			countdownEl.textContent = 'GO!';
			await new Promise(s=>setTimeout(s,500));
			countdownEl.style.opacity = '0';
			countdownEl.textContent = '';
			await new Promise(s=>setTimeout(s,160));
		}

		function simulateBotReaction(botElo){
			// Higher elo -> faster mean reaction and higher accuracy
			const base = 700 - (botElo - MIN_ELO) / 5; // lower is faster
			const jitter = Math.random()*300 - 150; // +-150ms
			let reaction = base + jitter + Math.random()*120; 
			reaction = clamp(reaction, 80, 4000);
			// chance to miss
			const missChance = clamp(0.45 - (botElo - MIN_ELO)/2000, 0.02, 0.5);
			const willMiss = Math.random() < missChance;
			return {reaction: Math.round(reaction), willMiss};
		}

		function expectedScore(a,b){
			return 1 / (1 + Math.pow(10, (b - a)/400));
		}

		function applyEloChange(playerElo, opponentElo, score){
			const exp = expectedScore(playerElo, opponentElo);
			const change = Math.round(K * (score - exp));
			return Math.max(MIN_ELO, playerElo + change);
		}

		queueBtn.addEventListener('click', async ()=>{
			// prevent queuing while in practice
			if(window.__practiceActive){ alert('Finish practice before queuing ranked matches.'); return; }
			queueBtn.disabled = true;
			// pick opponent before countdown so the player sees who they're facing
		 	const playerElo = getElo();
		 	currentBotElo = pickBotElo(playerElo);
		 	// use small random name generator (same style as leaderboard)
		 	try{
		 		currentBotName = (typeof makeBotName === 'function') ? makeBotName(randInt(0,29)) : 'Bot'+randInt(100,999);
		 	}catch(e){ currentBotName = 'Bot'+randInt(100,999); }
		 	botEloEl.textContent = currentBotElo;
		 	botNameEl.textContent = currentBotName;
		 	log.textContent = `Queued vs ${currentBotName} (ELO ${currentBotElo})`;
		 	// 3 second countdown then start match
		 	await doCountdown(3);
		 	startMatch();
		});

		// Practice mode: create a button next to queueBtn that toggles practice mode
		let practiceBtn = document.getElementById('practiceBtn');
		if(!practiceBtn){
			practiceBtn = document.createElement('button');
			practiceBtn.id = 'practiceBtn';
			practiceBtn.textContent = 'Practice Mode';
			practiceBtn.title = 'Enter endless practice mode';
			practiceBtn.style.marginRight = '8px';
			practiceBtn.style.background = '#ef4444';
			practiceBtn.style.borderRadius = '8px';
			practiceBtn.style.padding = '10px 14px';
			practiceBtn.style.color = '#fff';
			practiceBtn.style.cursor = 'pointer';
			// insert before queue button
			if(queueBtn && queueBtn.parentNode) queueBtn.parentNode.insertBefore(practiceBtn, queueBtn);
		}

		let practiceActive = false;
		window.__practiceActive = false; // small global flag for quick checks elsewhere

		async function practiceRound(){
			return new Promise(resolve => {
				const target = spawnTarget();
				const start = performance.now();
				let clicked = false;
				let playerTime = null;

				function onClick(){
					if(clicked) return; clicked = true;
					playerTime = Math.round(performance.now() - start);
					cleanup();
					resolve(playerTime);
				}
				target.addEventListener('click', onClick);

				// timer to remove after 5s
				let remaining = 5000;
				timeLeft.textContent = Math.ceil(remaining/1000) + 's';
				const tick = setInterval(()=>{
					remaining -= 100;
					timeLeft.textContent = Math.max(0, Math.ceil(remaining/1000)) + 's';
				},100);

				const timeout = setTimeout(()=>{
					if(!clicked) playerTime = null;
					cleanup();
					resolve(playerTime);
				},5000);

				function cleanup(){
					clearTimeout(timeout);
					clearInterval(tick);
					timeLeft.textContent = '-';
					arena.querySelectorAll('.target').forEach(n=>n.remove());
					target.removeEventListener('click', onClick);
				}
			});
		}

		async function startPractice(){
			if(practiceActive) return;
			practiceActive = true;
			window.__practiceActive = true;
			practiceBtn.textContent = 'End Practice';
			practiceBtn.style.background = '#065f46';
			queueBtn.disabled = true; // cannot queue while practicing
			log.textContent = 'Practice mode: hit the targets as they spawn. Click End Practice to stop.';
			// loop until practiceActive is false
			while(practiceActive){
				const t = await practiceRound();
				if(t === null){
					log.textContent = 'Missed the target — try again.';
				} else {
					log.textContent = `Hit! Reaction: ${t} ms`;
					// update player stats with practice reactions
					try{
						const stats = loadPlayerStats();
						stats.totalReaction = (stats.totalReaction || 0) + t;
						stats.totalRounds = (stats.totalRounds || 0) + 1;
						if(stats.bestReaction === null || t < stats.bestReaction) stats.bestReaction = t;
						savePlayerStats(stats);
					}catch(e){console.error('Failed to update stats from practice', e)}
				}
				// slight delay between targets
				await new Promise(s=>setTimeout(s, 350));
			}
			// cleanup on exit
			queueBtn.disabled = false;
			practiceBtn.textContent = 'Practice Mode';
			practiceBtn.style.background = '#ef4444';
			window.__practiceActive = false;
			log.textContent = 'Practice ended.';
		}

		function stopPractice(){
			practiceActive = false;
			// remove any lingering targets and reset UI
			arena.querySelectorAll('.target').forEach(n=>n.remove());
			timeLeft.textContent = '-';
		}

		practiceBtn.addEventListener('click', ()=>{
			if(practiceActive){ stopPractice(); }
			else { startPractice(); }
		});

		async function startMatch(){
			// prepare
			resultBox.classList.add('hidden');
			// remove any existing targets but keep the countdown/overlay elements intact
			arena.querySelectorAll('.target').forEach(n=>n.remove());
			roundHistory = [];
		 	const playerElo = getElo();
		 	let tempElo = playerElo; // update per-round for display
		 	// if bot wasn't preselected (should normally be set at queue), pick now
		 	if(!currentBotElo) currentBotElo = pickBotElo(playerElo);
		 	if(!currentBotName) {
		 		try{ currentBotName = (typeof makeBotName === 'function') ? makeBotName(randInt(0,29)) : 'Bot'+randInt(100,999);}catch(e){ currentBotName = 'Bot'+randInt(100,999); }
		 	}
		 	botEloEl.textContent = currentBotElo;
		 	botNameEl.textContent = currentBotName;
			currentRound = 0;
			playerWins = 0;
			log.textContent = 'Match started vs bot (ELO ' + currentBotElo + '). Good luck!';

			for(let r=1;r<=rounds;r++){
				currentRound = r;
				roundNum.textContent = `${r}/${rounds}`;
				const res = await playRound(tempElo, currentBotElo);

				// compute per-round elo change using tempElo at round start
				let roundScore;
				if(res.winner === 'player') roundScore = 1;
				else if(res.winner === 'draw') roundScore = 0.5;
				else roundScore = 0;

				// expected and change
				const exp = expectedScore(tempElo, currentBotElo);
				let change = Math.round(K_ROUND * (roundScore - exp));
				// punish misses more strongly
				const playerMiss = (res.playerTime === null);
				if(playerMiss && roundScore === 0){
					change = Math.round(change * 1.5);
				}

				const before = tempElo;
				tempElo = Math.max(MIN_ELO, tempElo + change);

				roundHistory.push({round: r, playerTime: res.playerTime, botTime: res.botTime, winner: res.winner, change, before, after: tempElo});

				if(res.winner === 'player'){
					playerWins++;
					log.textContent = `Round ${r}: You won (your ${res.playerTime}ms vs bot ${res.botTime === null ? 'miss' : res.botTime + 'ms'}).`;
				} else if(res.winner === 'bot'){
					log.textContent = `Round ${r}: Bot won (your ${res.playerTime === null ? 'miss' : res.playerTime + 'ms'} vs bot ${res.botTime}ms).`;
				} else {
					log.textContent = `Round ${r}: Draw.`;
				}

				await new Promise(s=>setTimeout(s,900));
			}

			// apply final elo (tempElo already updated per-round)
			const oldElo = playerElo;
			setElo(tempElo);

			// update player stats
			try{
				const stats = loadPlayerStats();
				stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
				if(playerWins > rounds/2) stats.wins = (stats.wins || 0) + 1; else if(playerWins < rounds/2) stats.losses = (stats.losses || 0) + 1;
				// record round reactions
				let reactions = roundHistory.map(r=>r.playerTime).filter(x=>x!==null && x!==undefined);
				if(reactions.length>0){
					const sum = reactions.reduce((a,b)=>a+b,0);
					stats.totalReaction = (stats.totalReaction || 0) + sum;
					stats.totalRounds = (stats.totalRounds || 0) + reactions.length;
					const avg = Math.round(stats.totalReaction / stats.totalRounds);
					stats.bestReaction = stats.bestReaction === null ? Math.min(...reactions) : Math.min(stats.bestReaction, Math.min(...reactions));
				}
				savePlayerStats(stats);
			}catch(e){console.error('Failed to update player stats', e)}

			// show history
			resultBox.classList.remove('hidden');
			let html = `<strong>Match complete</strong><br/>You won ${playerWins}/${rounds} rounds.<br/>ELO: ${oldElo} → ${tempElo}<hr/>`;
			html += `<div><strong>Round history</strong><br/><small>Format: round — you / bot — winner — elo change</small><ul>`;
			for(const h of roundHistory){
				html += `<li>Round ${h.round}: ${h.playerTime === null ? 'MISS' : h.playerTime + 'ms'} / ${h.botTime === null ? 'MISS' : h.botTime + 'ms'} — ${h.winner.toUpperCase()} — ${h.change >= 0 ? '+'+h.change : h.change} (→ ${h.after})</li>`;
			}
			html += `</ul></div>`;
			resultBox.innerHTML = html;

			queueBtn.disabled = false;
			// reset selected opponent so next queue generates a fresh one
			currentBotElo = null;
			currentBotName = null;
			botNameEl.textContent = '-';
			// mark subtasks completed in todo list
			try{ window.dispatchEvent(new Event('matchComplete')); }catch(e){}
		}

		function spawnTarget(){
			// remove old
			arena.querySelectorAll('.target').forEach(n=>n.remove());
			const t = document.createElement('div');
			t.className = 'target';
			// random pos inside arena, keep fully visible
			const rect = arena.getBoundingClientRect();
			const size = 60;
			const x = Math.random()*(rect.width - size);
			const y = Math.random()*(rect.height - size);
			t.style.left = x + 'px';
			t.style.top = y + 'px';
			arena.appendChild(t);
			return t;
		}

		function playRound(playerElo, botElo){
			return new Promise(resolve => {
				const target = spawnTarget();
				const start = performance.now();
				let clicked = false;
				let playerTime = null;
				let botTime = null;
				let resolved = false;

				const bot = simulateBotReaction(botElo);
				if(bot.willMiss){
					botTime = null; // miss
				} else {
					botTime = bot.reaction;
				}

				// Listen for player click
				function onClick(e){
					if(clicked) return;
					clicked = true;
					const t = Math.round(performance.now() - start);
					playerTime = t;
					cleanup();
					decide();
				}

				target.addEventListener('click', onClick);

				// Also allow clicking elsewhere to count as miss/slow
				function onArenaClick(ev){
					if(ev.target === target) return; // already handled
					// treat as miss if click not on target
				}
				arena.addEventListener('click', onArenaClick);

				// timer to remove target after 5s
				let remaining = 5000;
				timeLeft.textContent = Math.ceil(remaining/1000) + 's';
				const tick = setInterval(()=>{
					remaining -= 100;
					timeLeft.textContent = Math.max(0, Math.ceil(remaining/1000)) + 's';
				},100);

				const timeout = setTimeout(()=>{
					// time's up
					cleanup();
					if(!clicked) playerTime = null;
					decide();
				},5000);

				// Also schedule bot action (but bot could be after timeout -> counts as miss)
				if(botTime !== null){
					setTimeout(()=>{
						// if target still present and player hasn't already been resolved
						// bot clicked at botTime ms
						// nothing to do immediately; we compare times after timeout or player click
					}, botTime);
				}

				function cleanup(){
					clearTimeout(timeout);
					clearInterval(tick);
					timeLeft.textContent = '-';
					arena.querySelectorAll('.target').forEach(n=>n.remove());
					target.removeEventListener('click', onClick);
					arena.removeEventListener('click', onArenaClick);
				}

				function decide(){
					if(resolved) return; resolved = true;
					// Determine winner based on times and misses
					let winner = null;
					// convert botTime null => miss
					if(playerTime === null && botTime === null){
						winner = 'draw';
					} else if(playerTime === null && botTime !== null){
						winner = 'bot';
					} else if(playerTime !== null && botTime === null){
						winner = 'player';
					} else {
						// both have times
						if(playerTime < botTime) winner = 'player';
						else if(playerTime > botTime) winner = 'bot';
						else winner = 'draw';
					}
					resolve({winner, playerTime, botTime});
				}
			});
		}

		/* ---------------- Leaderboard logic (global) ---------------- */
		const LB_KEY = 'mock_leaderboard_v1';
		const LB_COUNT = 50;
		const LB_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
		const lbEl = document.getElementById('leaderboard');
		const PLAYER_STATS_KEY = 'player_stats_v1';
		let lastShownBoard = [];

		function makeBotName(i){
			const prefixes = ['Alpha','Neo','Void','xX','Hyper','Omega','Rapid','Silent','Ghost','Prime','Flux','Nova','Viper','Crimson','Azure','Iron','Steel','Quantum','Echo','Rogue','Drift','Sable','Frost','Blaze','Storm','Pulse','Vector','Zen','Apex','Bolt'];
			const suffixes = ['Slayer','One','Prime','Z','Hunter','X','Max','Pro','Bot','Unit','Zero','Edge','Core','Strike','Wing','Shift'];
			return prefixes[i % prefixes.length] + (Math.random()<0.35 ? suffixes[(i*7) % suffixes.length] : (Math.floor(Math.random()*900)+100));
		}

		function generateInitialLeaderboard(){
			const arr = [];
			for(let i=0;i<LB_COUNT;i++){
				const base = 1100 + Math.round(Math.pow(Math.random(),1.2) * 2000); // 1100..~3100
				// some mock stats
				const games = 50 + Math.round(Math.random()*800);
				const avgReaction = 200 + Math.round(Math.random()*400); // ms
				const wins = Math.round(games * (0.3 + Math.random()*0.5));
				arr.push({name: makeBotName(i), elo: base, gamesPlayed: games, avgReaction, wins});
			}
			arr.sort((a,b)=>b.elo-a.elo);
			return arr;
		}

		function saveLeaderboard(arr){ localStorage.setItem(LB_KEY, JSON.stringify(arr)); }
		function loadLeaderboard(){
			const raw = localStorage.getItem(LB_KEY);
			if(!raw) return null;
			try{ return JSON.parse(raw); }catch(e){ return null; }
		}

		function renderLeaderboard(){
			const board = loadLeaderboard() || generateInitialLeaderboard();
			const playerElo = getElo();
			const minElo = board.length === LB_COUNT ? board[board.length-1].elo : 0;
			let shown = board.slice();
			if(playerElo > minElo){
				shown.push({name:'You', elo: playerElo, isPlayer:true});
				shown.sort((a,b)=>b.elo - a.elo);
				shown = shown.slice(0, LB_COUNT);
			}
			lastShownBoard = shown.slice();
			let html = '<table style="width:100%;border-collapse:collapse">';
			for(let i=0;i<shown.length;i++){
				const row = shown[i];
				const pos = i+1;
				const isTop = (i === 0);
				const rankInfo = eloToRank(row.elo || 1000);
				const emblemSrc = rankInfo.img;
				// base row style
				let rowStyle = row.isPlayer ? 'background:#08313a' : '';
				// special highlight for top player (especially if Champion tier)
				if(isTop){
					rowStyle += 'box-shadow:0 6px 18px rgba(255,215,0,0.08);background:linear-gradient(90deg, rgba(255,243,205,0.04), transparent);border-left:4px solid gold;';
				} else if(rankInfo.tier === 'Grand Champion'){
					// Grand Champion highlight
					rowStyle += 'border-left:4px solid #ff5c7a;background:linear-gradient(90deg, rgba(255,92,122,0.04), transparent);';
				} else if(rankInfo.tier === 'Champion'){
					rowStyle += 'border-left:3px solid #c084fc;';
				}
				html += `<tr style="${rowStyle}">`;
				html += `<td style="width:36px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.03)"><strong>#${pos}</strong></td>`;
				const crown = isTop ? '👑 ' : '';
				html += `<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.03)"><img src="${emblemSrc}" onerror="this.src='img/emblems/bronze1.png'" style="width:24px;height:24px;vertical-align:middle;margin-right:8px;border-radius:4px"> ${crown}${row.name}</td>`;
				html += `<td style="text-align:right;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.03)"><strong>${row.elo}</strong></td>`;
				html += '</tr>';
			}
			html += '</table>';
			lbEl.innerHTML = html;
			// attach click handlers to rows to open profile
			const rows = lbEl.querySelectorAll('tr');
			rows.forEach((r, idx)=>{
				r.style.cursor = 'pointer';
				r.onclick = ()=>{ showProfileForEntry(lastShownBoard[idx]); };
			});
		}

		function refreshLeaderboardTick(){
			let board = loadLeaderboard();
			if(!board) board = generateInitialLeaderboard();
			for(let i=0;i<board.length;i++){
				const mood = (Math.random() - 0.5);
				const volatility = 20 + Math.random()*80;
				let change = Math.round(mood * volatility);
				if(Math.random() < 0.04) change += Math.round((Math.random()-0.5)*400);
				board[i].elo = Math.max(MIN_ELO, board[i].elo + change);
				// small simulated stat changes
				board[i].gamesPlayed = (board[i].gamesPlayed || 0) + Math.round(Math.random()*3);
				if(Math.random() < 0.5){
					// occasionally change avg reaction slightly
					board[i].avgReaction = Math.max(80, (board[i].avgReaction || 250) + Math.round((Math.random()-0.5)*20));
				}
			}
			board.sort((a,b)=>b.elo-a.elo);
			board = board.slice(0, LB_COUNT);
			saveLeaderboard(board);
			renderLeaderboard();
			log.textContent = 'Leaderboard refreshed — bots played games and ELOs changed.';
		}

		(function initLB(){
			if(!loadLeaderboard()){
				saveLeaderboard(generateInitialLeaderboard());
			}
			renderLeaderboard();
		})();

		setInterval(()=>{ refreshLeaderboardTick(); }, LB_REFRESH_MS);

		// Player stats persistence
		function loadPlayerStats(){
			const raw = localStorage.getItem(PLAYER_STATS_KEY);
			if(!raw) return {gamesPlayed:0,wins:0,losses:0,totalRounds:0,totalReaction:0,bestReaction:null};
			try{ return JSON.parse(raw); }catch(e){ return {gamesPlayed:0,wins:0,losses:0,totalRounds:0,totalReaction:0,bestReaction:null}; }
		}
		function savePlayerStats(s){ localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(s)); }

		function showProfileForEntry(entry){
			const profileContent = document.getElementById('profileContent');
			const title = document.getElementById('profileTitle');
			if(!entry) return;
			if(entry.isPlayer){
				const ps = loadPlayerStats();
				title.textContent = 'Your Profile';
				const avg = ps.totalRounds ? Math.round(ps.totalReaction / ps.totalRounds) : '-';
				profileContent.innerHTML = `
					<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
						<img src="${eloToRank(getElo()).img}" style="width:56px;height:56px;border-radius:6px" onerror="this.src='img/emblems/bronze1.png'">
						<div>
							<div style="font-weight:700">You</div>
							<div style="color:#9fc9ff">ELO: ${getElo()}</div>
						</div>
					</div>
					<ul>
						<li>Games played: ${ps.gamesPlayed}</li>
						<li>Matches won: ${ps.wins}</li>
						<li>Matches lost: ${ps.losses}</li>
						<li>Rounds played: ${ps.totalRounds}</li>
						<li>Average reaction: ${avg === '-' ? '-' : avg + ' ms'}</li>
						<li>Best reaction: ${ps.bestReaction === null ? '-' : ps.bestReaction + ' ms'}</li>
					</ul>`;
			} else {
				// bot entry
				title.textContent = `${entry.name} — Profile`;
				const avg = entry.avgReaction || '-';
				profileContent.innerHTML = `
					<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
						<img src="${eloToRank(entry.elo).img}" style="width:56px;height:56px;border-radius:6px" onerror="this.src='img/emblems/bronze1.png'">
						<div>
							<div style="font-weight:700">${entry.name}</div>
							<div style="color:#9fc9ff">ELO: ${entry.elo}</div>
						</div>
					</div>
					<ul>
						<li>Games played: ${entry.gamesPlayed || 0}</li>
						<li>Matches won: ${entry.wins || 0}</li>
						<li>Average reaction: ${avg === '-' ? '-' : avg + ' ms'}</li>
					</ul>`;
			}
			document.getElementById('profileModal').style.display = 'flex';
		}

		// Profile modal hooks
		const profileClose = document.getElementById('profileClose');
		profileClose.addEventListener('click', ()=>{ document.getElementById('profileModal').style.display = 'none'; });
		document.getElementById('profileModal').addEventListener('click', (e)=>{ if(e.target.id === 'profileModal') document.getElementById('profileModal').style.display = 'none'; });


		// Help modal behavior
		const helpBtn = document.getElementById('helpBtn');
		const helpModal = document.getElementById('helpModal');
		const helpClose = document.getElementById('helpClose');
		helpBtn.addEventListener('click', ()=>{ helpModal.style.display = 'flex'; });
		helpClose.addEventListener('click', ()=>{ helpModal.style.display = 'none'; });
		helpModal.addEventListener('click', (e)=>{ if(e.target === helpModal) helpModal.style.display = 'none'; });
		document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') helpModal.style.display = 'none'; });

		// Backup / restore (encrypted) helpers
		const backupBtn = document.getElementById('backupBtn');
		const restoreBtn = document.getElementById('restoreBtn');

		function strToBuf(str){ return new TextEncoder().encode(str); }
		function bufToStr(buf){ return new TextDecoder().decode(buf); }
		function arrayBufferToBase64(buffer){
			let binary = '';
			const bytes = new Uint8Array(buffer);
			const len = bytes.byteLength;
			for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
			return btoa(binary);
		}
		function base64ToArrayBuffer(base64){
			const binary = atob(base64);
			const len = binary.length;
			const bytes = new Uint8Array(len);
			for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
			return bytes.buffer;
		}

		async function deriveKey(password, salt){
			const pwBuf = strToBuf(password);
			const keyMaterial = await crypto.subtle.importKey('raw', pwBuf, {name:'PBKDF2'}, false, ['deriveKey']);
			return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'}, keyMaterial, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
		}

		async function encryptString(plaintext, password){
			const salt = crypto.getRandomValues(new Uint8Array(16));
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const key = await deriveKey(password, salt);
			const enc = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, strToBuf(plaintext));
			return {salt: arrayBufferToBase64(salt.buffer), iv: arrayBufferToBase64(iv.buffer), data: arrayBufferToBase64(enc)};
		}

		async function decryptToString(encryptedObj, password){
			try{
				const salt = base64ToArrayBuffer(encryptedObj.salt);
				const iv = base64ToArrayBuffer(encryptedObj.iv);
				const data = base64ToArrayBuffer(encryptedObj.data);
				const key = await deriveKey(password, new Uint8Array(salt));
				const dec = await crypto.subtle.decrypt({name:'AES-GCM', iv:new Uint8Array(iv)}, key, data);
				return bufToStr(dec);
			}catch(e){
				throw new Error('Decryption failed — wrong password or corrupted file.');
			}
		}

		backupBtn.addEventListener('click', async ()=>{
			const pwd = prompt('Enter a password to encrypt your backup (remember it)');
			if(!pwd){ alert('Backup cancelled'); return; }
			const payload = { elo: getElo(), leaderboard: loadLeaderboard() };
			const enc = await encryptString(JSON.stringify(payload), pwd);
			const out = {version:1, created: Date.now(), enc};
			const blob = new Blob([JSON.stringify(out)], {type:'application/json'});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `aim2-backup-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
			a.click();
			URL.revokeObjectURL(url);
			alert('Backup saved to your downloads folder. Keep the password safe.');
		});

		restoreBtn.addEventListener('click', ()=>{
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json,application/json';
			input.onchange = async (e)=>{
				const f = e.target.files[0];
				if(!f) return;
				const text = await f.text();
				let obj;
				try{ obj = JSON.parse(text); }catch(err){ alert('Selected file is not valid JSON'); return; }
				const pwd = prompt('Enter the password used to encrypt this backup');
				if(!pwd){ alert('Restore cancelled'); return; }
				try{
					const dec = await decryptToString(obj.enc, pwd);
					const payload = JSON.parse(dec);
					if(payload.elo !== undefined){ setElo(payload.elo); }
					if(payload.leaderboard){ saveLeaderboard(payload.leaderboard); renderLeaderboard(); }
					alert('Restore complete. Your ELO and leaderboard have been restored.');
				}catch(err){ alert(err.message || 'Restore failed'); }
			};
			input.click();
		});

	})();