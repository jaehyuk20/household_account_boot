/*
 * 픽셀 스프라이트
 * 모든 그림은 팔레트 글자로 된 격자입니다. '.'은 투명, ol:true면 바깥 테두리를 자동으로 그립니다.
 * 렌더 결과는 SVG data URL로 캐시해서 <img>나 CSS 배경, 캔버스 파티클에 같이 씁니다.
 */
(function (global) {
  'use strict';

  const PAL = {
    o: '#4a3527', // 테두리
    k: '#2b211c',
    w: '#ffffff',
    W: '#e7e1d6',
    l: '#d3ccc0',
    L: '#9a9287',
    r: '#f2645a',
    R: '#c4433c',
    p: '#ff9fbd',
    P: '#e0698f',
    e: '#ffab4c',
    E: '#e07b28',
    y: '#ffd84a',
    Y: '#e3a91f',
    g: '#7dd35c',
    G: '#3f9b3c',
    b: '#6ab8f2',
    B: '#3b7ec7',
    c: '#c4f0fb',
    n: '#c98a50',
    N: '#8e5a2e',
    m: '#f6d9a8',
    M: '#dcae6e',
    u: '#b893f2',
    U: '#8460d3',
    t: '#4ccaa6',
    T: '#24977a',
    s: '#fff1d6',
    f: '#e8955a', // 다람쥐 털
    F: '#c46f3a',
    h: '#f7bd84',
    '~': '#ffffffb3', // 김
    '*': '#ffffff', // 반짝이
  };
  const SOFT = new Set(['~', '*']); // 테두리를 만들지 않는 픽셀
  const OUTLINE = 'o';

  /* ───────── 카테고리 아이콘 (16×16) ───────── */
  const DEFS = {
    food: { ol: true, px: [
      '................',
      '.....~...~......',
      '......~...~.....',
      '.....~...~......',
      '................',
      '......wwww......',
      '....wwwwwwww....',
      '...wwwwwwwwwW...',
      '..cccccccccccc..',
      '..bbwbbwbbwbbb..',
      '...bbbbbbbbbB...',
      '....bbbbbbbB....',
      '.....BBBBBB.....',
      '......BBBB......',
      '................',
      '................',
    ] },
    cafe: { ol: true, px: [
      '................',
      '....~..~........',
      '.....~..~.......',
      '....~..~........',
      '................',
      '..wwwwwwwwww....',
      '..wNNNNNNNNw....',
      '..wwwwwwwwwwww..',
      '..wwwpwpwwww.w..',
      '..wwwpppwwww.w..',
      '..wwwwpwwwwwww..',
      '..WwwwwwwwwW....',
      '...WWWWWWWW.....',
      '.mmmmmmmmmmmm...',
      '................',
      '................',
    ] },
    living: { ol: true, px: [
      '................',
      '.oo.............',
      '...o...ee.gg....',
      '...o..eEeegGgg..',
      '...obbbbbbbbbbb.',
      '....bcbbcbbcbbb.',
      '....bbbbbbbbbb..',
      '.....bcbbcbbcb..',
      '.....bbbbbbbbb..',
      '......oooooooo..',
      '......o.........',
      '......ooooooooo.',
      '................',
      '.......LL...LL..',
      '.......LL...LL..',
      '................',
    ] },
    shopping: { ol: true, px: [
      '................',
      '................',
      '......oooo......',
      '.....o....o.....',
      '.....o....o.....',
      '...pppppppppp...',
      '...wppppppppP...',
      '...pprrpprrpP...',
      '...pprrrrrrpP...',
      '...ppprrrrppP...',
      '...pppprrpppP...',
      '...pppppppppP...',
      '...pppppppppP...',
      '...PPPPPPPPPP...',
      '................',
      '................',
    ] },
    transport: { ol: true, px: [
      '................',
      '................',
      '...TTTTTTTTTT...',
      '..tttttttttttt..',
      '..tcccccccccct..',
      '..tcwcccccccct..',
      '..tcccccccccct..',
      '..tttttttttttt..',
      '..tyyttttttyyt..',
      '..tttttttttttt..',
      '..TTTTTTTTTTTT..',
      '...LL......LL...',
      '...LL......LL...',
      '................',
      '................',
      '................',
    ] },
    housing: { ol: true, px: [
      '................',
      '................',
      '.......rr.......',
      '......rrrr......',
      '.....rrrrrr.....',
      '....rrrrrrrr....',
      '...rrrrrrrrrr...',
      '..RRRRRRRRRRRR..',
      '...mmmmmmmmmm...',
      '...mbbmmmNNmm...',
      '...mcbmmmNNmm...',
      '...mmmmmmNyNm...',
      '...mmmmmmNNmm...',
      '................',
      '................',
      '................',
    ] },
    health: { ol: true, px: [
      '................',
      '................',
      '..rrrr....rrrr..',
      '.rprrrr..rrrrrr.',
      '.rprrrrrrrrrrrr.',
      '.rrrrrrwwrrrrrr.',
      '.rrrrrrwwrrrrrr.',
      '.rrrrwwwwwwrrrr.',
      '..rrrwwwwwwrrr..',
      '...rrrrwwrrrr...',
      '....rrrwwrrr....',
      '.....rrrrrr.....',
      '......rrrr......',
      '.......rr.......',
      '................',
      '................',
    ] },
    leisure: { ol: true, px: [
      '................',
      '................',
      '................',
      '................',
      '...uuuuuuuuuu...',
      '..uuuuuuuuuuuu..',
      '.uuukuuuuuuuyuu.',
      '.uukkkuuuuurugu.',
      '.uuukuuuuuuubuu.',
      '.uuuuuuuuuuuuuu.',
      '.uuuu......uuuu.',
      '.uuu........uuu.',
      '................',
      '................',
      '................',
      '................',
    ] },
    travel: { ol: true, px: [
      '................',
      '.......ww.......',
      '.......bb.......',
      '.......ww.......',
      '.......ww.......',
      '......wwww......',
      '....wwwwwwww....',
      '..wwwwwwwwwwww..',
      '.bwwwwwwwwwwwwb.',
      '.......ww.......',
      '.......ww.......',
      '.......ww.......',
      '.....wwwwww.....',
      '.....bwwwwb.....',
      '................',
      '................',
    ] },
    education: { ol: true, px: [
      '................',
      '................',
      '...gggggggggg...',
      '...Gggggggggg...',
      '...Ggwwwwwwgg...',
      '...Ggwwwwwwgg...',
      '...Gggggggggg...',
      '...Gggggggggg...',
      '...Gggggggggg...',
      '...Gggggggggg...',
      '...Gggggggggg...',
      '...Gwwwwwwwww...',
      '...GGGGGGGGGG...',
      '..........r.....',
      '................',
      '................',
    ] },
    gift: { ol: true, px: [
      '................',
      '................',
      '.....yy..yy.....',
      '....y..yy..y....',
      '.....yyyyyy.....',
      '..rrrrryyrrrrr..',
      '..RRRRRyyRRRRR..',
      '...rrrryyrrrr...',
      '...rrrryyrrrr...',
      '...rrrryyrrrr...',
      '...rrrryyrrrr...',
      '...rrrryyrrrr...',
      '...RRRRyyRRRR...',
      '................',
      '................',
      '................',
    ] },
    etc: { ol: true, px: [
      '................',
      '................',
      '................',
      '...wwwwwwwwww...',
      '..wwwwwwwwwwww..',
      '..wwwwwwwwwwww..',
      '..wwLLwLLwLLww..',
      '..wwLLwLLwLLww..',
      '..wwwwwwwwwwww..',
      '...wwwwwwwwww...',
      '....ww..........',
      '....w...........',
      '................',
      '................',
      '................',
      '................',
    ] },

    salary: { ol: true, px: [
      '................',
      '................',
      '......mmmm......',
      '.......mm.......',
      '......NNNN......',
      '.....mmmmmm.....',
      '....mmmmmmmm....',
      '...mmmmyymmmM...',
      '..mmmmyYYymmmM..',
      '..mmmmyYYymmmM..',
      '..mmmmmyymmmmM..',
      '..mmmmmmmmmmmM..',
      '...MMMMMMMMMM...',
      '................',
      '................',
      '................',
    ] },
    bonus: { ol: true, px: [
      '................',
      '.......yy.......',
      '......yyyy......',
      '......yyyy......',
      '.....yywyyy.....',
      '.yyyyyywyyyyyyy.',
      '..yyyyyyyyyyyy..',
      '...yyyyyyyyyy...',
      '....yyyyyyyy....',
      '....yyyyyyyy....',
      '...yyyyyyyyyy...',
      '...yyyyYYyyyy...',
      '..yyyyY..Yyyyy..',
      '..yyY......Yyy..',
      '................',
      '................',
    ] },
    side: { ol: true, px: [
      '................',
      '................',
      '..llllllllll....',
      '..lwllllllllll..',
      '..LLLLLLLLLL.LL.',
      '.......nN.......',
      '.......nN.......',
      '.......nN.......',
      '.......nN.......',
      '.......nN.......',
      '.......nN.......',
      '.......nN.......',
      '.......NN.......',
      '................',
      '................',
      '................',
    ] },
    allowance: { ol: true, px: [
      '................',
      '................',
      '................',
      '.wwwwwwwwwwwwww.',
      '.LwwwwwwwwwwwwL.',
      '.wLwwwwwwwwwwLw.',
      '.wwLwwwwwwwwLww.',
      '.wwwLwwwwwwLwww.',
      '.wwwwLrrrrLwwww.',
      '.wwwwwrrrrwwwww.',
      '.wwwwwwrrwwwwww.',
      '.wwwwwwwwwwwwww.',
      '.WWWWWWWWWWWWWW.',
      '................',
      '................',
      '................',
    ] },
    invest: { ol: true, px: [
      '................',
      '.....g....g.....',
      '....ggg..ggg....',
      '.....gGggGg.....',
      '.......gG.......',
      '......uuuu......',
      '....uuuuuuuu....',
      '...uuwwwwwwuu...',
      '...wwwwwwwwwW...',
      '...wwwwwwwwwW...',
      '....wwwwwwwW....',
      '.....wwwwwW.....',
      '.......wW.......',
      '.......W........',
      '................',
      '................',
    ] },
    resale: { ol: true, px: [
      '................',
      '..L.............',
      '...L............',
      '....L...........',
      '.....yyyyyyyy...',
      '....yyyyyyyyyy..',
      '...yyy.yyyyyyy..',
      '...yyyyyyyyyyy..',
      '....yyyyyyyyyy..',
      '.....YYYYYYYYY..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ] },
    refund: { ol: true, px: [
      '................',
      '....ggggggggg...',
      '...g.......gggg.',
      '............gg..',
      '......yyyy......',
      '.....yywyyy.....',
      '....yywyyyyy....',
      '....ywyyyyYy....',
      '....yyyyyyYy....',
      '....yyyyyYYy....',
      '.....yyyYYy.....',
      '......yyyy......',
      '..gg............',
      '.gggg.......g...',
      '...ggggggggg....',
      '................',
    ] },
    clover: { ol: true, px: [
      '................',
      '................',
      '...gggg..gggg...',
      '..gggggggggggg..',
      '..gGgggggggggg..',
      '..ggggggggggGg..',
      '...ggggggggggg..',
      '....gggGGggg....',
      '...ggggggggggg..',
      '..gggggggggggg..',
      '..gGggggggggGg..',
      '...gggg..gggg...',
      '.........G......',
      '..........G.....',
      '................',
      '................',
    ] },

    /* ───────── UI ───────── */
    leaf: { ol: true, px: [
      '................',
      '..........ggg...',
      '........gggggg..',
      '......ggggggGg..',
      '.....gggggggGg..',
      '....ggggggGggg..',
      '....gggggGgggg..',
      '...ggggGGgggg...',
      '...gggGggggg....',
      '...ggGggggg.....',
      '...gGggggg......',
      '....Ggggg.......',
      '...G............',
      '..G.............',
      '................',
      '................',
    ] },
    coin: { ol: true, frames: [
      [
        '..........',
        '...yyyy...',
        '..yywyyy..',
        '.yywyyyYy.',
        '.yyyyyyYy.',
        '.yyyyyyYy.',
        '.yyyyyYYy.',
        '..yyYYyy..',
        '...yyyy...',
        '..........',
      ],
      [
        '..........',
        '...yyyy...',
        '...ywyy...',
        '...yyyY...',
        '...yyyY...',
        '...yyyY...',
        '...yyyY...',
        '...yyYy...',
        '...yyyy...',
        '..........',
      ],
      [
        '..........',
        '....yy....',
        '....wy....',
        '....yY....',
        '....yY....',
        '....yY....',
        '....yY....',
        '....yY....',
        '....yy....',
        '..........',
      ],
      [
        '..........',
        '...yyyy...',
        '...yywy...',
        '...Yyyy...',
        '...Yyyy...',
        '...Yyyy...',
        '...Yyyy...',
        '...yYyy...',
        '...yyyy...',
        '..........',
      ],
    ] },
    arrowL: { ol: true, px: [
      '.........',
      '.....y...',
      '....yy...',
      '...yyy...',
      '..yyyy...',
      '...yyy...',
      '....yy...',
      '.....y...',
      '.........',
    ] },
    arrowR: { ol: true, px: [
      '.........',
      '...y.....',
      '...yy....',
      '...yyy...',
      '...yyyy..',
      '...yyy...',
      '...yy....',
      '...y.....',
      '.........',
    ] },
    close: { ol: true, px: [
      '..........',
      '.ww....ww.',
      '.www..www.',
      '..wwwwww..',
      '...wwww...',
      '...wwww...',
      '..wwwwww..',
      '.www..www.',
      '.ww....ww.',
      '..........',
    ] },
    check: { ol: true, px: [
      '..........',
      '.......ww.',
      '......www.',
      '.ww..www..',
      '.wwwwww...',
      '..wwww....',
      '...ww.....',
      '..........',
    ] },
    trash: { ol: true, px: [
      '............',
      '....llll....',
      '.llllllllll.',
      '.LLLLLLLLLL.',
      '..llLllLll..',
      '..llLllLll..',
      '..llLllLll..',
      '..llLllLll..',
      '..llLllLll..',
      '..LLLLLLLL..',
      '............',
    ] },
    sun: { ol: true, px: [
      '..............',
      '......yy......',
      '..y...yy...y..',
      '...y......y...',
      '.....yyyy.....',
      '....yyyyyy....',
      '.yy.yyyyyy.yy.',
      '.yy.yyyyyy.yy.',
      '....yyyyyy....',
      '.....yyyy.....',
      '...y......y...',
      '..y...yy...y..',
      '......yy......',
      '..............',
    ] },
    moon: { ol: true, px: [
      '..............',
      '.....yyyy.....',
      '....yyy.......',
      '...yyy........',
      '..yyyy........',
      '..yyyy........',
      '..yyyy........',
      '..yyyyy.......',
      '..yyyyyy....y.',
      '...yyyyyyyyy..',
      '....yyyyyyy...',
      '......yyy.....',
      '..............',
      '..............',
    ] },
    sprout: { ol: true, px: [
      '................',
      '................',
      '................',
      '..gggg....gggg..',
      '.ggggGg..gGgggg.',
      '..gggggGGggggg..',
      '....gggGGggg....',
      '.......GG.......',
      '.......GG.......',
      '.......GG.......',
      '....nnnnnnnn....',
      '..nnnnnnnnnnnn..',
      '..NnnnnnnnnnnN..',
      '...NNNNNNNNNN...',
      '................',
      '................',
    ] },
    pouch: { ol: true, px: [
      '..............',
      '.....yyyy.....',
      '......yy......',
      '.....YYYY.....',
      '....yyyyyy....',
      '...yyyyyyyy...',
      '..yyywwyyyyy..',
      '..yywyyyyyYy..',
      '..yyyyyyyyYy..',
      '..yyyyyyyYYy..',
      '...yyyyYYyy...',
      '....yyyyyy....',
      '..............',
    ] },
    basket: { ol: true, px: [
      '..............',
      '....oooooo....',
      '...o......o...',
      '..o........o..',
      '.rrrrrrrrrrrr.',
      '.rwrrrrrrrrRr.',
      '..rrrrrrrrRr..',
      '..rrrrrrrrRr..',
      '...rrrrrrRr...',
      '...RRRRRRRR...',
      '..............',
    ] },

    /* ───────── 배경 소품 ───────── */
    cloudL: { ol: false, px: [
      '..........wwwwww..................',
      '.......wwwwwwwwwwww.......www.....',
      '.....wwwwwwwwwwwwwwww...wwwwwwww..',
      '...wwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
      '.wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
      '.WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.',
      '...WWWWWWWWWWWWWWWWWWWWWWWWWWWWW..',
    ] },
    cloudS: { ol: false, px: [
      '......wwww..........',
      '...wwwwwwwww..www...',
      '.wwwwwwwwwwwwwwwwww.',
      'wwwwwwwwwwwwwwwwwwww',
      '.WWWWWWWWWWWWWWWWWW.',
    ] },
    canopy: { ol: true, px: [
      '..........................',
      '..........zzzzzz..........',
      '.......zzzzzzzzzzaa.......',
      '.....zzzzzzzzzaaaaaaa.....',
      '....zzzzzzzzaaaaaaaaaa....',
      '...zzzzzzaaaaqaaaaaaaaa...',
      '..zzzzzaaaaaaaaaaaaaaaaa..',
      '..zzzzqaaaaaaaaaaAaaaaaa..',
      '.zzzzaaaaaaaaaaaaaaaaqaaa.',
      '.zzzaaaaAaaaaaaaaaaaaaaaa.',
      '.zzaaaaaaaaaaaqaaaaaaaaAa.',
      '.zaaAaaaaaaaaaaaaaaaaAaaa.',
      '.aaaaaaaaqaaaaaaaaaaaaaAa.',
      '..aaaaaaaaaaaaaaaaaaaaAA..',
      '..AaaaaaaaaaaaaaaaaaqaAA..',
      '...AAaaaaaaaaaaaaaaaAAA...',
      '....AAAaaaaaaaaaaaaAAA....',
      '......AAAAAAAAAAAAAA......',
      '..........................',
    ] },
    trunk: { ol: true, px: [
      '..........................',
      '...........nnN............',
      '...........nnN............',
      '...........nnN............',
      '...........nnN............',
      '...........nnN............',
      '..........nnnNN...........',
      '.........nnnnNNN..........',
      '..........................',
    ] },
    flower: { ol: true, frames: [
      [
        '.........',
        '...aaa...',
        '..aaaaa..',
        '..aayaa..',
        '..aaaaa..',
        '...aaa...',
        '....G....',
        '..gGG....',
        '...gGgg..',
        '....G....',
        '.........',
      ],
      [
        '.........',
        '....aaa..',
        '...aaaaa.',
        '...aayaa.',
        '...aaaaa.',
        '....aaa..',
        '....G....',
        '..gGG....',
        '...gGgg..',
        '....G....',
        '.........',
      ],
    ] },
    tuft: { ol: false, px: [
      '.G...G..',
      '.G.G.G.G',
      'GGGGGGGG',
    ] },
    star: { ol: false, px: [
      '..y..',
      '.yyy.',
      'yyyyy',
      '.yyy.',
      '..y..',
    ] },

    plus: { ol: true, px: [
      '............',
      '....wwww....',
      '....wwww....',
      '....wwww....',
      '.wwwwwwwwww.',
      '.wwwwwwwwww.',
      '.wwwwwwwwww.',
      '.wwwwwwwwww.',
      '....wwww....',
      '....wwww....',
      '....wwww....',
      '............',
    ] },
    user: { ol: true, px: [
      '............',
      '....tttt....',
      '...twtttt...',
      '...tttttt...',
      '...tttttt...',
      '....tttt....',
      '............',
      '..tttttttt..',
      '.twttttttTt.',
      '.ttttttttTt.',
      '.TTTTTTTTTT.',
      '............',
    ] },
    door: { ol: true, px: [
      '............',
      '..NNNNNNNN..',
      '..NnnnnnnN..',
      '..NnMMMMnN..',
      '..NnMnnMnN..',
      '..NnMMMMnN..',
      '..NnnnnnnN..',
      '..NnnnnyyN..',
      '..NnnnnnnN..',
      '..NnMMMMnN..',
      '..NnnnnnnN..',
      '..NNNNNNNN..',
      '............',
    ] },
    expand: { ol: true, px: [
      '............',
      '.wwww..wwww.',
      '.w........w.',
      '.w........w.',
      '............',
      '............',
      '............',
      '............',
      '.w........w.',
      '.w........w.',
      '.wwww..wwww.',
      '............',
    ] },
    shrink: { ol: true, px: [
      '............',
      '...w....w...',
      '...w....w...',
      '.www....www.',
      '............',
      '............',
      '............',
      '............',
      '.www....www.',
      '...w....w...',
      '...w....w...',
      '............',
    ] },
    viewPhone: { ol: true, px: [
      '..........',
      '..bbbbbb..',
      '..bccccb..',
      '..bccccb..',
      '..bccccb..',
      '..bccccb..',
      '..bccccb..',
      '..bccccb..',
      '..bbbbbb..',
      '..bbwwbb..',
      '..bbbbbb..',
      '..........',
    ] },
    viewWide: { ol: true, px: [
      '..............',
      '.bbbbbbbbbbbb.',
      '.bccbccccbccb.',
      '.bccbccccbccb.',
      '.bccbccccbbbb.',
      '.bccbccccbccb.',
      '.bccbccccbccb.',
      '.bbbbbbbbbbbb.',
      '......LL......',
      '....LLLLLL....',
      '..............',
    ] },
    coinS: { ol: true, frames: [
      ['.......', '..yyy..', '.ywyyy.', '.yyyYy.', '.yyYYy.', '..yyy..', '.......'],
      ['.......', '...y...', '..ywy..', '..yyY..', '..yYY..', '...y...', '.......'],
      ['.......', '...y...', '...y...', '...Y...', '...Y...', '...y...', '.......'],
      ['.......', '...y...', '..yyw..', '..Yyy..', '..YYy..', '...y...', '.......'],
    ] },
    maple: { ol: false, frames: [
      ['...a...', '.a.a.a.', '.aaaaa.', 'aaaaaaa', '.aaaaa.', '..aAa..', '...A...'],
      ['.......', '..a.a..', '..aaa..', '.aaaaa.', '..aaa..', '..aA...', '...A...'],
      ['.......', '...a...', '...a...', '..aaa..', '...a...', '...A...', '...A...'],
    ] },
    petal: { ol: false, frames: [
      ['.pp.', 'pppp', '.pP.'],
      ['..p.', '.pp.', '.P..'],
    ] },

    /* ───────── 마스코트: 다람쥐 토리 (24×24) ───────── */
    tori: { ol: true, frames: [
      // 0: 기본
      [
        '........................',
        '..ff......ff...hhhh.....',
        '..fpf....fpf..hhhhhhh...',
        '..ffffffffff..hhfffffhh.',
        '.ffffffffffff.hffFFfffh.',
        '.ffffffffffff.hfffffFfh.',
        '.ffffffffffff..hffffFfh.',
        '.ffwkffffwkff..hfffFffh.',
        '.ffkkffffkkff..hffffffh.',
        '.fppfhkkhfppf...hfffffh.',
        '.ffffFhhFffff...hfffffh.',
        '..ffffffffff....hffffh..',
        '...ffffffff....hhffffh..',
        '...ffsssssff...hfffffh..',
        '..fffNNNNNfff..hffffffh.',
        '..ffhNnNnNhff..hffffffh.',
        '..ffhmMMMMhff..hfffffhh.',
        '..fsssMMMsssf...hffffh..',
        '...fsssnsssf...hffffh...',
        '....fssssssf..hhfffh....',
        '....ffffffff.hhhhh......',
        '...fff....fff...........',
        '........................',
        '........................',
      ],
      // 1: 눈 깜빡
      [
        '........................',
        '..ff......ff...hhhh.....',
        '..fpf....fpf..hhhhhhh...',
        '..ffffffffff..hhfffffhh.',
        '.ffffffffffff.hffFFfffh.',
        '.ffffffffffff.hfffffFfh.',
        '.ffffffffffff..hffffFfh.',
        '.ffffffffffff..hfffFffh.',
        '.ffkkffffkkff..hffffffh.',
        '.fppfhkkhfppf...hfffffh.',
        '.ffffFhhFffff...hfffffh.',
        '..ffffffffff....hffffh..',
        '...ffffffff....hhffffh..',
        '...ffsssssff...hfffffh..',
        '..fffNNNNNfff..hffffffh.',
        '..ffhNnNnNhff..hffffffh.',
        '..ffhmMMMMhff..hfffffhh.',
        '..fsssMMMsssf...hffffh..',
        '...fsssnsssf...hffffh...',
        '....fssssssf..hhfffh....',
        '....ffffffff.hhhhh......',
        '...fff....fff...........',
        '........................',
        '........................',
      ],
      // 2: 말하는 중 (입 벌림)
      [
        '........................',
        '..ff......ff...hhhh.....',
        '..fpf....fpf..hhhhhhh...',
        '..ffffffffff..hhfffffhh.',
        '.ffffffffffff.hffFFfffh.',
        '.ffffffffffff.hfffffFfh.',
        '.ffffffffffff..hffffFfh.',
        '.ffwkffffwkff..hfffFffh.',
        '.ffkkffffkkff..hffffffh.',
        '.fppfhkkhfppf...hfffffh.',
        '.ffffhRRhffff...hfffffh.',
        '..fffhRRhfff....hffffh..',
        '...ffffffff....hhffffh..',
        '...ffsssssff...hfffffh..',
        '..fffNNNNNfff..hffffffh.',
        '..ffhNnNnNhff..hffffffh.',
        '..ffhmMMMMhff..hfffffhh.',
        '..fsssMMMsssf...hffffh..',
        '...fsssnsssf...hffffh...',
        '....fssssssf..hhfffh....',
        '....ffffffff.hhhhh......',
        '...fff....fff...........',
        '........................',
        '........................',
      ],
    ] },
  };

  /* ───────── 렌더러 ───────── */
  function toGrid(rows) {
    return rows.map((r) => r.split(''));
  }

  function addOutline(g) {
    const h = g.length;
    const w = g[0].length;
    const out = g.map((r) => r.slice());
    const solid = (x, y) =>
      y >= 0 && y < h && x >= 0 && x < w && g[y][x] !== '.' && g[y][x] !== OUTLINE && !SOFT.has(g[y][x]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (g[y][x] !== '.') continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) out[y][x] = OUTLINE;
      }
    }
    return out;
  }

  const gridCache = new Map();
  function grid(name, frame = 0) {
    const key = name + '#' + frame;
    if (gridCache.has(key)) return gridCache.get(key);
    const def = DEFS[name];
    if (!def) throw new Error('unknown sprite: ' + name);
    const rows = def.frames ? def.frames[frame % def.frames.length] : def.px;
    let g = toGrid(rows);
    if (def.ol) g = addOutline(g);
    gridCache.set(key, g);
    return g;
  }

  function frameCount(name) {
    const def = DEFS[name];
    return def.frames ? def.frames.length : 1;
  }

  function colorAttr(hex) {
    if (hex.length === 9) {
      const a = parseInt(hex.slice(7), 16) / 255;
      return `fill="${hex.slice(0, 7)}" fill-opacity="${a.toFixed(2)}"`;
    }
    return `fill="${hex}"`;
  }

  // 같은 색이 이어지는 가로 구간을 하나의 rect로 묶습니다.
  function runs(g, pal, ox = 0, oy = 0) {
    const out = [];
    for (let y = 0; y < g.length; y++) {
      const row = g[y];
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        if (ch === '.') {
          x++;
          continue;
        }
        let x2 = x + 1;
        while (x2 < row.length && row[x2] === ch) x2++;
        const col = pal[ch] || PAL[ch];
        if (col) out.push([x + ox, y + oy, x2 - x, col]);
        x = x2;
      }
    }
    return out;
  }

  function svgOf(w, h, rectRuns) {
    let body = '';
    for (const [x, y, len, col] of rectRuns) body += `<rect x="${x}" y="${y}" width="${len}" height="1" ${colorAttr(col)}/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${body}</svg>`;
  }

  const urlCache = new Map();
  function dataURL(svg) {
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function palKey(pal) {
    return pal ? Object.entries(pal).map(([k, v]) => k + v).join('') : '';
  }

  /** 스프라이트 한 프레임을 data URL로 */
  function url(name, opts = {}) {
    const { frame = 0, pal = null } = opts;
    const key = `${name}|${frame}|${palKey(pal)}`;
    if (urlCache.has(key)) return urlCache.get(key);
    const g = grid(name, frame);
    const u = dataURL(svgOf(g[0].length, g.length, runs(g, pal || {})));
    urlCache.set(key, u);
    return u;
  }

  /** 모든 프레임을 가로로 이어 붙인 시트 (CSS steps() 애니메이션용) */
  function sheet(name, opts = {}) {
    const { pal = null } = opts;
    const key = `sheet|${name}|${palKey(pal)}`;
    if (urlCache.has(key)) return urlCache.get(key);
    const n = frameCount(name);
    const g0 = grid(name, 0);
    const w = g0[0].length;
    const h = g0.length;
    let all = [];
    for (let i = 0; i < n; i++) all = all.concat(runs(grid(name, i), pal || {}, i * w, 0));
    const u = dataURL(svgOf(w * n, h, all));
    urlCache.set(key, u);
    return u;
  }

  function size(name) {
    const g = grid(name, 0);
    return { w: g[0].length, h: g.length };
  }

  /** <img> 하나 만들기. scale은 픽셀 배율 */
  function img(name, scale = 2, opts = {}) {
    const el = document.createElement('img');
    const { w, h } = size(name);
    el.src = url(name, opts);
    el.width = w * scale;
    el.height = h * scale;
    el.alt = opts.alt || '';
    el.className = 'px-img' + (opts.className ? ' ' + opts.className : '');
    el.decoding = 'async';
    el.draggable = false;
    return el;
  }

  /* 아이콘을 둥근 픽셀 타일 위에 얹은 그림 (목록에서 사용) */
  const TILE = [
    '....cccccccccccc....',
    '..cccccccccccccccc..',
    '.cccccccccccccccccc.',
    '.cccccccccccccccccc.',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    'cccccccccccccccccccc',
    '.dddddddddddddddddd.',
    '.dddddddddddddddddd.',
    '..dddddddddddddddd..',
    '....dddddddddddd....',
  ];

  function tile(name, fill, shade) {
    const key = `tile|${name}|${fill}|${shade}`;
    if (urlCache.has(key)) return urlCache.get(key);
    const bg = runs(toGrid(TILE), { c: fill, d: shade });
    const icon = runs(grid(name, 0), {}, 2, 1);
    const u = dataURL(svgOf(20, 20, bg.concat(icon)));
    urlCache.set(key, u);
    return u;
  }

  /** 캔버스 파티클용: 픽셀 구간 목록 */
  function pixels(name, frame = 0, pal = null) {
    return runs(grid(name, frame), pal || {});
  }

  global.Sprites = { PAL, DEFS, url, sheet, size, img, tile, pixels, frameCount, grid };
})(window);
