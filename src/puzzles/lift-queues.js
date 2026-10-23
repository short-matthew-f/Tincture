// puzzles/lift-queues.js — The Lifting Table's lanes, keys, stored solutions and
// difficulty stats (pure data), copied from proto/lift/queues.js (written by
// proto/lift/gen-levels.mjs). Do not edit by hand: regenerate in proto/lift/,
// then copy (test/lift.test.js checks they match).
// stats: jars in the level; solver solution length in moves and nodes expanded;
// casual = how often a random "lift when you can" player clears it without help
// (seed 4242, 100 runs); losing / firstMoves = first moves proved to leave
// no clear (unknown = search ran out); parks = fewest parks any clear needs
// (parksExact false: an upper bound from the stored solution); traps = other
// moves along the solution that a quick search proves dead, trapSteps = how
// many steps have at least one.
export const QUEUES = {
  sun: {
    seed: 1, fit: 0.95,
    queues: [
      's10 o3 s10 o4',
      'g10 g3 o5 s10 s5 s4',
    ],
    locks: [],
    solution: 'L1 L0 L0 L0 L0 L1 L1 L1 L1 L1',
    stats: {jars: 10, moves: 10, nodes: 10, casual: 1, firstMoves: 2, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 0, trapSteps: 0},
  },
  tulip: {
    seed: 1, fit: 0.95,
    queues: [
      'g5 c10 k8 r8 c6 g6 c10 c5',
      'c10 c10 p1 c10 k3 r7',
    ],
    locks: [],
    solution: 'L1 L1 L0 L0 L0 L0 L0 L0 L0 L0 L1 L1 P0 L1 L1 U0',
    stats: {jars: 14, moves: 16, nodes: 16, casual: 1, firstMoves: 2, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 0, trapSteps: 0},
  },
  teacup: {
    seed: 20, fit: 0.35,
    queues: [
      'b3 l8 c10 c10 c3',
      'h10 h10 h10 c5 c4 h9',
      'h8 a6 b4 h10',
    ],
    locks: [],
    solution: 'L1 L1 L1 L1 L2 L0 L0 L0 L0 L2 L1 L1 L2 L2 L0',
    stats: {jars: 15, moves: 15, nodes: 15, casual: 0.82, firstMoves: 3, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 0, trapSteps: 0},
  },
  sail: {
    seed: 18, fit: 0.5,
    queues: [
      'c10 b10 b5 s4 s10 s5',
      'k5 s10 c6 k8 s10 r1',
      'b5 k9 s10 s8 s5',
    ],
    locks: [],
    solution: 'L2 L0 L0 L2 L2 L2 L0 L1 L1 L0 L1 L1 L0 L1 L0 L2 L1',
    stats: {jars: 17, moves: 17, nodes: 17, casual: 0.9, firstMoves: 3, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 0, trapSteps: 0},
  },
  skein: {
    seed: 21, fit: 0.5,
    queues: [
      'k12 ?k12 m10 ?y12 ?q8 ?i3 ?m7 m6',
      'm8 ?q12 i12 ?y7 ?y12 k3 ?y10 y4',
      'k12 i8 l12 ?q12 ?p12 ?p3 p8 q5 p6 y8',
    ],
    locks: [],
    solution: 'L0 L0 L2 L2 L2 L2 L0 L0 P0 L0 L0 L2 L1 L1 P0 L1 U1 L1 L1 L1 L0 L1 L2 L2 L2 L0 L2 L2 L1 U0',
    stats: {jars: 26, moves: 30, nodes: 31, casual: 0.59, firstMoves: 3, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 0, trapSteps: 0},
  },
  mushrooms: {
    seed: 13, fit: 0.65,
    queues: [
      'f10 f11 g15 ?f8 w5 j15 w4 ?q3 ?j15 j4 j8 r6',
      'f10 g5 ?j10 w10 g14 ?f8 c8 r8 r10 ?d4 c4 r3 j9',
      'w5 ?q4 d8 ?q8 ?a8 ?g10 r15 j15 g3 ?w10 w7 j15 j9',
    ],
    locks: [],
    solution: 'L0 L0 L1 L0 L0 L1 L1 L0 L0 L0 L0 L1 P0 L1 U0 L1 L0 L1 L1 L1 P0 L1 L0 L2 P0 L2 U1 P0 U0 P0 L2 P0 L2 L2 L2 L2 L2 U2 L0 L0 L1 L2 L2 L1 L1 L2 L2 L2 P0 U1 U0 U0',
    stats: {jars: 38, moves: 52, nodes: 172, casual: 0.61, firstMoves: 3, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 19, trapSteps: 9},
  },
  sheep: {
    seed: 1, fit: 0.65,
    queues: [
      'w15 w15 g10 g4 w15 c12 b8 ?c15 k10 b15 ?i5 b7 ?b6 c4',
      'w15 k8 i10 l10 g3 c15 ?k14 ?u10 ?c15 u15 ?u3 l3 ?b15 b3 ?b8',
      'w15 b12 w15 w12 k7 c15 c15 c15 b10 c15 b15 k3 ?c10 ?c15',
      'w15 u15 c15 ?r6 ?w15 r9 u3 w7 ?c12 c15 u15 ?u12 ?b15',
    ],
    locks: [],
    solution: 'L0 L0 L1 L2 L3 L0 L1 L0 L0 L0 L1 L1 L1 L1 L1 L0 P0 L0 L1 P0 L1 L2 L2 L2 U0 U0 P0 L2 P0 L2 L2 L2 L3 P0 L3 L3 L3 L0 L1 L0 U2 P1 L0 U0 P0 L3 U1 L3 P0 L3 L3 L3 L0 L3 L2 L2 L2 L0 L0 U1 L2 L2 L3 L3 L2 U0 L1 P0 L1 L1 U1 L1 L1 U0',
    stats: {jars: 56, moves: 74, nodes: 184, casual: 0.34, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 45, trapSteps: 16},
  },
  cherries: {
    seed: 13, fit: 0.65,
    queues: [
      'c8=d8 r13 d15 h5 k7 h8=h10 q9 h12=h13',
      'r11 h3 c15=h12 r6 q15 d7 q15 r3 h5',
      'r15 c15 r12 r10 q6 k10=h12 c3 q5',
    ],
    locks: [],
    solution: 'L1 L0 L2 L2 L0 L1 L1 L2 L0 L2 L2 L1 L1 L2 L1 L1 L2 L0 L2 L1 L1 L0 L0 L0 L0',
    stats: {jars: 30, moves: 25, nodes: 26, casual: 0.66, firstMoves: 3, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 0, trapSteps: 0},
  },
  cottage: {
    seed: 7, fit: 0.5,
    queues: [
      'w20=l20 ?e5=r20 ?e18 k15=x6 ?d8 r8 x20 n6 c8=x4 c4',
      'w12=c15 w10 c11 d10 c20=p8 c20 c20 x7 x20 c9 c10',
      'w8 w20 ?w14 c20 c15 c8 c17 r20=r20 ?c20 p8 r10 ?l6 x13',
      'w20 c20 c20 k8 p13 x20 k7 ?r20 x12 r8 c10 c15 x10=x4',
    ],
    locks: [],
    solution: 'L3 L0 L1 L1 L3 L3 L2 L2 L1 L0 L0 L1 L3 L2 P0 L2 L0 L1 L0 L3 P0 L0 L1 P0 L0 U0 P0 L1 L2 L0 L1 U0 L2 L3 P0 L3 L3 L2 L2 L2 L1 L0 L2 L2 L3 L0 L2 L1 L1 L2 L3 L3 U1 L3 L3 P0 U0 U0 U0',
    stats: {jars: 55, moves: 59, nodes: 87, casual: 0.3, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 22, trapSteps: 12},
  },
  apple: {
    seed: 20, fit: 0.5,
    queues: [
      'g7 w10 x15 r15 ?g20 g12 j20 d5 j20 s14 ?g12',
      'w13=g10 w15 w10 f13 s15 s3=x10 r15 ?g9 s10 x4=s4',
      'g10 k11 x9 o20 x20 w5 ?w3 g20 d5 ?g4 r3=s15',
      'w10=g15 k8 j8=s12 k8 ?j18 f6 ?g11 g8 j8 s10',
    ],
    locks: [],
    solution: 'L3 L1 L2 L1 L2 L0 L0 L3 L3 L1 L1 L3 P0 L3 L0 L1 L2 L2 L0 L0 L0 L0 U0 L0 L0 L2 L2 L2 L2 L3 L0 L1 L1 L0 L2 L3 L1 L2 L2 L3 L3 L1 L1 L3',
    stats: {jars: 48, moves: 44, nodes: 44, casual: 0.17, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 0, trapSteps: 0},
  },
  lighthouse: {
    seed: 19, fit: 0.35,
    queues: [
      'v20 v20 v20 v20 v20 i11 y10 h15 y19 c20 y3 r14 r20 a4+r5 r7 a5+y5 r15',
      'h12 v20 v4+i5 v5+r5 i20 v5+a4 u10 i3 k10 a16 a20 r5+k4 c20 c5+a5 y6 c3+r4 r10 r20',
      'v20 y12 u4 v20 h3+a4 h7 c5+h3 u3 c5+h5 v3 h5+a5 k3 y5+r5 c20 a20 a9 c3',
      'u4+i3 v20 v20 c12 v5+c5 k20 h5+r5 h20 y20 h18 v10 i4 y5+c4 y14 y10 c7 a10 c6 r14',
    ],
    locks: [],
    solution: 'L0 L0 L0 L0 L0 L2 L3 L3 L3 L1 L1 L0 L1 L1 L1 L1 L1 L0 L0 L3 L3 L3 L3 P0 L3 L0 L0 L2 L1 L1 P0 L1 L1 P0 U0 L1 P0 U0 L2 P0 L2 U2 L2 L2 L2 P0 L3 L3 L1 L3 U0 U0 L1 L1 L0 L0 L1 L3 L3 L3 U0 L0 L0 P0 L2 L2 L3 L3 L3 L3 L1 L2 L2 L0 L0 U0 L2 L2 L2 L2 L1 L0 L2 L2 L3',
    stats: {jars: 71, moves: 85, nodes: 88, casual: 0.29, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 17, trapSteps: 6},
  },
  cat: {
    seed: 17, fit: 0.95,
    queues: [
      'k20 i20 ?k20 ?v6 n4 ?n6 c12 c10 ?n14 k15 n3+k5 v5+q3 ?n9',
      'k4 ?o20 i4+a3 ?v15 l5 k20 ?q7 k20 ?a5 v20 n18 ?c5=n5',
      'i20 i20 l20 ?v15 a12 a12 i8 n14 a12 n6=k7 v12',
      'i5+l3 i5+k4 q19 ?k20 u20 u3=n16 c5+u5 ?o4 u9 q3=k20 ?o3+v5 u14',
    ],
    locks: [],
    solution: 'L2 L0 L0 L2 L0 L2 L3 L3 L3 L2 L2 L3 L3 L0 L0 L1 L1 L2 L1 L1 L3 L2 L3 P0 L3 P0 L1 P0 L1 L2 L1 L1 L3 L3 L2 L0 L0 L3 L2 L2 L0 L0 U1 L1 L1 L1 P0 L3 L0 U0 L1 L0 L0 L0 U0 U0',
    stats: {jars: 52, moves: 56, nodes: 57, casual: 0.18, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 17, trapSteps: 9},
  },
  teapot: {
    seed: 5, fit: 0.35,
    queues: [
      'r5 r20 ?c5+q5 r4 ?h12 b16 ?e11 b12 ?q20 e3+h5 ?h10 h3',
      'c19=q15 h19 h20 b19 d12 n17 b20 d5 q20=q20',
      'h3+q4 h20 r10 c17 n7 ?c18 c8 ?q20 n4+h4 q20=q20 h20=q13',
      'c5=d10 e5+h5 ?h13 l5+b4 l4=h12 s11 q5+n8 ?b20 b8=q4',
    ],
    locks: [],
    solution: 'L0 L1 L0 L1 L1 L3 L0 L3 P0 L0 L3 L3 P0 L1 P3 L1 L1 U2 P0 L0 L2 U1 U0 P0 P1 L2 L2 L2 L2 L1 L0 L0 L2 L0 U2 U0 L0 L3 L3 L3 P0 L3 L1 L1 L0 L2 L2 L3 L0 L2 L2 P0 U0 U1 L2 U0 L0',
    stats: {jars: 48, moves: 57, nodes: 676, casual: 0.13, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 42, trapSteps: 18},
  },
  quilt: {
    seed: 15, fit: 0.95,
    queues: [
      'f12 g16 e10 e10 c5 f6 c3 y10 g4 s19 c11 x6 c9 x12 g7 y7 s12',
      'f20 b5+c5 y8 c20 g6 e18 t12 c8 y12 x8 r10 c4 s5 t8 b4 s3',
      'g15 c4+r3 g18 b4 r12 x10 s4 f3 s10 c10 e8 x9 b3 s20 g5 r3',
      'g20 f20 f10 c20 t20 b10 x16 b14 r12 s12 g5 g3 c15 s20 s20 y3',
    ],
    locks: [],
    solution: 'L1 L2 L0 L3 L3 L0 L0 L1 L2 L2 L3 L3 L3 L0 L1 L1 L1 L3 L3 P0 L0 L0 L1 L1 L1 L1 L1 L1 L1 L3 L3 L3 L3 L0 L1 L1 L0 L2 L2 P0 L2 L2 L2 P0 L2 L2 U0 L2 U1 P0 L0 L0 P0 L0 L2 L3 L1 L1 L0 U0 U0 P0 L2 P1 L2 L2 L0 U0 L0 L0 L0 P0 L0 U1 L3 P0 L3 L2 U2 L3 P0 U0 L3 U0 U0',
    stats: {jars: 65, moves: 85, nodes: 3382, casual: 0.11, firstMoves: 4, losing: 0, unknown: 0, parks: 10, parksExact: false, traps: 34, trapSteps: 22},
  },
  hedgehog: {
    seed: 21, fit: 0.35,
    queues: [
      'a6=q10 ?k15 l16 ?a3 d5 l20 ?i12 z4 k20 ?k9 i8+q5 ?z6 l11',
      'l10=i4 i5 i4+k3 q20 k4+i3 i4 ?k3+l4 q20 z3+q3 l18 q7 q8 z5=l9',
      'l4+k4 r3 ?z12 a8 k15=l12 ?a4 q11 k20 i12 ?l13 ?i19 q20 ?l3+z3 ?q3',
      'k20 o20 k15 i6 i9 i6 ?r15 q12 k12 d3+k4 k9=o5 q20 q15',
    ],
    locks: [],
    solution: 'L3 L2 L0 L0 L1 L1 L0 L3 L3 L2 L2 L2 L1 L3 L2 L1 L2 L3 L1 L2 L2 L2 L2 L0 P0 L0 U0 L0 P0 L1 P0 L1 P0 L1 L1 U2 L3 P0 L3 L2 L1 L2 U0 L3 P0 L3 L0 L3 L3 U1 L2 L3 P0 L0 L0 U2 U0 L0 L0 P0 L0 L0 U0 L1 L1 P0 P0 L1 L3 U2 U1 U0 L2',
    stats: {jars: 58, moves: 73, nodes: 360, casual: 0.08, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 42, trapSteps: 19},
  },
  bee: {
    seed: 22, fit: 0.8,
    queues: [
      'f12 ?g20 j10 g15 ?g5+s5 s20 ?h20=x17 ?s20 x20 x20 h6 s11',
      'x15 g20 ?g20 s18 f7 ?i12 g8 s5+x5 v3 s20 s20 x17 s14 s5',
      'g20=s15 v10 u12 i3 s5+g5 ?s20 s20 g10 i7 x5+v4 x20 ?s5=x9',
      'f12=p20 j20 ?g3+s3 s20 i10 u12 j6 x20 p9 h7 x11=x15',
    ],
    locks: [],
    solution: 'L2 L0 L0 L0 L0 L3 L0 L0 L1 L1 L3 L1 L1 L2 L1 P0 L3 L3 L2 U0 L1 P0 L1 L1 P0 P0 L1 L1 L1 L0 L0 L3 L0 L0 L3 U2 L0 P0 L0 U2 L3 L1 P0 L1 L1 L2 L2 L2 U0 L3 P0 U0 P1 U0 P1 U0 P1 U1 L2 P3 L2 L2 U0 L2 P0 U1 P0 L2 U0 U1 L3 U0 L3 L3 L2',
    stats: {jars: 54, moves: 75, nodes: 725, casual: 0.01, firstMoves: 4, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 51, trapSteps: 30},
  },
  birdhouse: {
    seed: 13, fit: 0.35,
    queues: [
      'j20 j20 o4 y20 q9 x20 x20 y8 x20 k10 d12 x20 x3 s14',
      'g20 g4=k20 o15 d10 k15 x20 x15 d13 o10 k3 k12 s6 k6 y3',
      'x15 k17=s12 y6 q6 q20 r20 o6 x20 x15 r12 x7 k10 x15',
      'o5 y6 d12 x20 j4 s20 x20 y10 y10 x20 s10 r5 s12 q5 q4 s4',
    ],
    locks: [[3,11,7]],
    solution: 'L0 L1 L0 L1 L1 L2 L2 L2 L2 L2 L0 L0 L1 L1 P0 L1 L1 L1 L1 L2 P0 U0 P0 L0 P0 L0 L0 L0 L0 U1 U1 L0 P0 L0 P0 L0 U1 P0 U1 P0 L0 U0 L3 P0 L3 L3 L3 L3 U0 L3 P0 L3 L3 U0 U1 L3 L3 L2 L2 U0 L2 P0 L2 L2 L2 L0 L2 L1 L3 L3 L1 L3 U0 L3 L1 L1 L1 L3 L3',
    stats: {jars: 59, moves: 79, nodes: 410, casual: 0.04, firstMoves: 3, losing: 0, unknown: 0, parks: 11, parksExact: false, traps: 51, trapSteps: 22},
  },
  loom: {
    seed: 7, fit: 0.8,
    queues: [
      'e25 g20 r25 k25 g21 ?o10 y25 g10 l21 k4+r5 a10 ?y14 e4=r25 r12',
      'e4+r5 e25 k10 a12 r25=r12 ?n20 r25 n3 ?r3+y4 l4+r5 r25 k4+r3 ?r7',
      'e25=n12 e25 ?y4+r5 d3+k3 ?o20 ?e25=n20 ?k25 e10 r25 k15 r21 y4+a6 r10 ?r13',
      'r25 k25 ?y25 ?d20 y25 y17 y17 n21=d5 k4+e5 k25 l8 k6 y25 ?r21 ?y11',
    ],
    locks: [[3,29,11]],
    solution: 'L0 L2 L2 L1 L1 L0 L0 L0 L0 L0 L0 L1 L0 L2 L2 L2 L0 P0 L0 L2 L2 L3 L3 L3 L3 L3 L0 L2 P0 L2 L2 L2 L3 L0 U1 L1 P0 L1 L1 L3 P0 L3 L1 L1 U0 L3 P0 L3 L2 L0 U1 L3 L0 L1 L1 P0 L3 U0 L3 P0 U0 L1 L3 L2 L1 L3 L2 U1 U0 L1',
    stats: {jars: 61, moves: 70, nodes: 2266, casual: 0.05, firstMoves: 3, losing: 0, unknown: 0, parks: 0, parksExact: true, traps: 34, trapSteps: 15},
  },
  owl: {
    seed: 1, fit: 0.5,
    queues: [
      'i10 l25 n5+l4 n5+c3 k13 g6 ?n3+i4 n25 n25 a8 ?i25=n15 y5+o4 a4 ?n6 c4 ?l3 ?k4 ?n3',
      'k25 b3+n3 n4 b25 b11 n14 o3 k25 n25 n25 c18 n12 i10 i13 l7 a12 k11 i4',
      'b25 b25 b25 ?n25 b14 g5+n5 ?a3 n5+k5 a4 ?c12 ?o5 ?y6 i11 i9=n12 i25 ?l5',
      'k10 n25 n5+k3 i7=n20 ?k4+a3 ?c3 k15 a5 o4+i3 l3 ?a7 n5+l3 k13 ?a3 k3 c3',
    ],
    locks: [[3,11,18]],
    solution: 'L2 L2 L2 L2 L2 L1 L1 L2 L2 L2 L2 L1 L1 L0 L0 L0 P0 L0 P0 L0 L1 P3 L1 U0 L1 P0 L1 L1 L1 U2 L3 L0 L3 L1 L1 L0 L0 P0 U1 L1 L0 L3 L1 L0 L0 P0 L0 L1 U2 L0 L0 P1 L3 L3 U0 P0 L0 U1 L0 P0 L0 U2 U0 P0 L1 P3 L1 U2 L2 L2 L2 L1 L0 L3 P1 L3 L3 U1 L2 P1 L2 U0 L3 L3 L3 P2 U0 P3 U1 P2 U0 P0 L3 L3 U0 P0 L2 L2 U0 U1 L3 P0 L3 P0 U1 P1 U1 P1 L3 U0 U0 U0',
    stats: {jars: 71, moves: 112, nodes: 3725, casual: 0, firstMoves: 3, losing: 0, unknown: 0, parks: 22, parksExact: false, traps: 105, trapSteps: 60},
  },
  fox: {
    seed: 3, fit: 0.95,
    queues: [
      'o25 r3 z20 k20 a5+z5 ?z15 ?z15 c23 a25 a6 a7 ?y15 a6 q19 c4+a4 c16 q10 q5+y3',
      'k4+q4 d4 ?z5=y10 a5+d5 i12 ?d7 ?a23 c12 k3 o3 a5+q5 ?a9 q25 c17 ?c13 ?q3 d3 z4',
      'z13 q25 k20 z25 r3 a10 ?d11 ?z19 d6 d4+y4 z6 r11 q22 i8 y3+c4 y19 y5 ?y4 ?y4',
      'q12 d5 ?i4+c4 a10 ?y12 z9 o12 ?z10=y15 d7 ?o5 q23 a5+q5 i10 y9 ?a7 c10 i4 ?y4',
    ],
    locks: [[3,20,24]],
    solution: 'L2 L1 L1 L0 P0 L0 L0 P0 L0 L0 L0 U1 P0 L1 P1 L1 L1 U2 U1 P0 L2 P0 L2 L0 L1 U2 L1 P0 L2 L1 U1 L0 L0 P0 U1 P0 U0 L2 U0 P0 L2 P0 L2 L2 L2 L2 U2 L0 L2 L2 L0 L2 L2 P0 U0 U0 P0 L1 P0 L1 L1 L2 U1 P0 U1 L3 P0 L3 L2 U2 L3 L3 P1 L3 L3 L3 L1 L1 U2 L2 L3 P1 L3 L3 L3 L2 U2 P1 L3 U2 P0 L0 L0 U2 L1 P0 L3 L1 L1 U0 L0 P0 L0 L3 L0 U1 L3 L0 P0 L2 U1 L1 P0 U1 P0 U0 L1 L0 U0 U0 L3 L3 P0 L3 U0',
    stats: {jars: 75, moves: 125, nodes: 2060, casual: 0, firstMoves: 3, losing: 0, unknown: 0, parks: 26, parksExact: false, traps: 180, trapSteps: 72},
  },
  harbor: {
    seed: 1, fit: 0.8,
    queues: [
      'b5+m4 b20 ?b4+c3 b25 b5+e5 b25 ?b14=n12 d10 ?l5+c3 ?g10 g8 ?c25 c4+g4 s4=c8 s4 m6 c12',
      'b4+g5 ?b12 b25 b25 b25 y10 e25 y5+g3 g7 s17 c25 m9 ?b13 c25 ?s3+c3 g10=c10',
      's15 ?b15 ?b25 b25 ?b25 ?b25 ?b25 ?n8 ?d5+e5 b20 l3+e3 g25 c25 ?c5+s3 e8 ?g4+c5 ?c7',
      'e25 d3 ?l4+c5 c3+b3 d9 y4 e23 l4+c4 y4 ?l15 l3 ?l4 g4+b5 y4 c25 c18',
    ],
    locks: [[3,10,0]],
    solution: 'L0 L0 L0 L0 L0 P0 L0 L1 P0 L1 L1 L1 L1 L0 U0 P0 L2 P0 L2 L2 L2 L2 L2 L2 L1 L1 U2 P0 L0 U1 P1 L0 L3 L0 L3 L3 L0 L0 L1 L0 L3 U0 L1 U0 P0 P0 L2 L2 L2 L2 L0 U2 L3 P0 L3 L3 U1 L3 P0 L3 L1 L3 L0 L2 L1 L1 L1 L1 U1 L2 P2 L0 U0 P1 L2 U1 P1 L2 L2 L3 L3 L3 L0 U0 P0 L2 U0 P0 U1 P0 U1 L1 P0 L1 L3 L3 L3 U1 U1 U0',
    stats: {jars: 69, moves: 100, nodes: 10532, casual: 0, firstMoves: 3, losing: 0, unknown: 0, parks: 17, parksExact: false, traps: 143, trapSteps: 63},
  },
  wheel: {
    seed: 24, fit: 0.8,
    queues: [
      'q25 k25 l12 a7 c12 k5+i3 ?k4+q3 i11 k20 ?k7 l12 q25 ?a7 o11 ?c6 l4',
      'k24 i25 i25 ?q12 ?o25 a13 q5+a3 q25 k19 l18 ?q25 l8 ?l10 q23',
      'k22 i25 ?k25 ?o4 k5+q5 ?a4+q3 ?k25 ?q3+i3 q15=q25 i11=k10 q16 ?k3 q12',
      'q5+a4 ?a20 q25 q18 q12 i12 ?q25 q3+i4 q4 q15 ?q5+a4 q25 ?q8 q5 k4+q5 q18',
    ],
    locks: [[3,21,4]],
    solution: 'L1 L1 L2 L1 L0 L0 L2 L2 L0 L1 L0 L1 P0 L1 L1 L1 P0 L1 U1 U0 L0 P0 L0 L3 L0 L1 L1 L3 P0 L3 L3 L3 L0 P0 L0 L0 L2 L2 U2 L0 L3 P0 L0 U0 P1 L3 L2 L2 L3 L3 L3 L3 L3 L3 L2 L2 L1 L2 U1 L2 L1 U1 P0 L1 P0 U0 P0 U1 P0 U0 L0 P0 U1 P0 L0 L3 L3 L3 L2 U2 U0 L2 L0 L0 U0',
    stats: {jars: 61, moves: 85, nodes: 3192, casual: 0.02, firstMoves: 3, losing: 0, unknown: 0, parks: 13, parksExact: false, traps: 67, trapSteps: 24},
  },
  dyepot: {
    seed: 22, fit: 0.8,
    queues: [
      'e25 e5+y4 a21 l15=c15 i25=c25 l9 ?e25 i4+l5 ?i25 i25 c21 i25 ?i4+e5 ?c10 l5+i5 ?a4+c5 ?l3 c5+e3',
      'i6=i6 y12 e25 ?z12 e5+i4 ?t10 ?y20 c17 a8 ?d7 e5+i5 z3 l5+c5 l25 c25 ?c5+i5',
      'i25 ?l18 c25 c5+i5 ?c25 i16 c12 c3+y6 c25 c12 c5+i5 c25 i18 c3+e4',
      'd25 e10 i5+c5 i25 ?i25 ?c25 ?c25 ?z7 d4+t4 c25 i4+c5 c5+i5 c4 ?c10 t9 c6',
    ],
    locks: [[2,23,8],[3,20,6]],
    solution: 'L0 L1 L1 L1 L0 L0 L0 L0 L0 L0 L0 L0 L0 L2 L0 L2 L2 L1 L0 P0 L0 L0 L0 L0 L2 L2 L2 L2 L1 L1 L2 L2 U0 L0 L2 P0 L2 P0 L3 L3 L2 L2 L3 L0 L3 U1 U0 L1 L1 P0 L1 P0 U0 L1 L1 P2 L1 L1 L1 L1 L3 L3 L3 L1 L3 L3 L3 L3 U0 L3 U0 L3 L3 L3 L2 L3',
    stats: {jars: 67, moves: 76, nodes: 532, casual: 0.01, firstMoves: 2, losing: 0, unknown: 0, parks: 6, parksExact: false, traps: 62, trapSteps: 29},
  },
  strawberries: {
    seed: 2, fit: 0.5,
    queues: [
      'b12 c21 p5+d5 r14 ?p19 c12 b25 d25 d9 h25=p12 ?b18 ?r3+b4 ?r5 d3+h5 ?y5 h7',
      'p20 r5+j10 p6 c13 ?d25 c13 c6 b21 y13 h25 ?d3 h17 b3 b3 ?r3 d4+h5 d3',
      'h25 d6 ?c5+r5 p25 ?n5+r5 n7 n12 r15 p7 p11 ?c8 r5+h5 c6 p10 g6 ?n6 p8 h22',
      'r12 g3 ?c10 h25 ?y4+h5 h17 b5 ?p10 d5 ?y3 h16 h3 r5+h4 d8=h20 y7 h20 r7 h15',
    ],
    locks: [[3,12,9]],
    solution: 'L1 L1 L1 L1 L1 L1 L2 P0 L2 P0 L2 L2 U1 L2 L2 L0 L0 L0 L0 P1 L0 L0 L0 L0 L1 U1 L1 L1 L3 U0 P0 L2 P1 L2 L2 L1 L1 U0 P0 L2 L1 U0 L1 P0 L2 L0 U0 P0 U0 P0 L0 U1 P1 L0 L2 L2 U1 P0 L3 L1 U0 L1 P1 L1 L1 L3 U0 L3 P0 L2 L3 U1 P0 U0 P0 L3 L3 U0 P1 U0 L3 P1 L3 L3 L3 L0 U1 L3 L0 P0 L0 L2 L2 L0 L3 U0 L0 U0 P0 P0 L3 L3 L3 L3 L2 L3 U0 L2 U0',
    stats: {jars: 71, moves: 109, nodes: 16560, casual: 0, firstMoves: 3, losing: 0, unknown: 1, parks: 20, parksExact: false, traps: 172, trapSteps: 82},
  },
  mittens: {
    seed: 1, fit: 0.95,
    queues: [
      'c20 e25 x25 ?x25 x25 c25 ?c25 k20 b7 s8 b5+d5 s5+b5 c25 ?r18 b25 b11 ?n10 n3',
      'x15=g12 e4+x4 ?x25 ?x20=r25 c25 ?g15 x12 ?n12 b22 n4 ?s16 g3+n3 ?r10 ?e3 b14 n20',
      'x11 ?r7 g3 s10 b3+n5 c4+b5 n12 b10 ?s10 b22 ?b15 ?s3 ?e4 b5+k5 ?n5+k3 k3 b5 b6',
      'd10 ?x5 b3+c5 b3+n4 ?c4+n3 e8 s12 b4+n4 s4 n3+b4 c12 c12 ?n17 ?b3+k4 n10 ?d4 s9=n12 ?k4',
    ],
    locks: [[2,19,29],[3,13,13]],
    solution: 'L1 L1 L1 L0 L0 L0 L0 L1 L1 L0 L0 L0 L0 L0 P0 L0 L0 U0 P0 L0 P0 L0 L1 L1 L1 L1 L0 L0 L1 L1 L0 L2 L0 U0 U0 L1 L2 P0 L2 P0 L2 L3 L2 U0 P0 U0 P0 L2 U1 L3 P0 L3 L3 U0 L1 P0 L3 L3 L3 U1 L3 P0 L3 L3 L1 L2 L2 L3 L2 L2 L2 L2 L2 L2 L2 L3 L2 L3 U1 L1 P0 L0 U0 P1 L3 L3 L3 U0 L3 U0 L1 L2 L3 L2',
    stats: {jars: 73, moves: 94, nodes: 8141, casual: 0, firstMoves: 2, losing: 0, unknown: 0, parks: 2, parksExact: true, traps: 123, trapSteps: 57},
  },
  village: {
    seed: 21, fit: 0.95,
    queues: [
      'f14 g23 ?k25 ?f17 g22 k25 k25 k25 k25 k25 v15 ?n14 ?p23 ?v5+m5 p5 ?m25 ?k9 n4+y5',
      'f25 f25=m12 y6=n25 f10 k25 k25 ?k25 ?k25 p25 c10 ?y20=n10 m20 n5+y4 ?f3 p4',
      'n6 m16 n15 p5+m5 m25 n5+k5 g5 y12 p20 k25 ?m16=n5 p3+n4 m17 m20 n8',
      'p10=n12 m12=c5 ?p5 k10 ?y4=n5 v8 n20 n10 n13 n15 p10 m10 n11 m3',
    ],
    locks: [[2,33,10],[3,1,1]],
    solution: 'L1 L1 L0 L0 L0 L0 L0 L0 L0 L0 L0 L0 P0 L1 L1 P0 L1 L1 L1 L1 L1 U0 L1 L0 L0 L0 L0 L0 P0 L0 L1 L1 L0 L1 L0 U0 U0 P0 L2 L2 P0 L2 L2 U0 P0 L3 L2 L2 U0 L2 L1 L3 L3 L3 L3 L3 L3 L1 U0 L3 L2 L2 P0 L2 L3 L2 L2 P0 L2 L2 L3 L3 L2 L3 U1 L3 L3 U0',
    stats: {jars: 69, moves: 78, nodes: 104, casual: 0, firstMoves: 2, losing: 0, unknown: 0, parks: 1, parksExact: true, traps: 29, trapSteps: 27},
  },
  sampler: {
    seed: 1, fit: 0.5,
    queues: [
      'l10 q12 l25 d25 ?l4+d5 d5+r5 l4+d5 d3+g4 ?l25 f12=d12 l25 ?r14 l25 ?g8 ?l25 ?r4 l5+r4 g3 l25 b7',
      'd25 y15 d5+r4 r11 l10 l25 y11 d25 b4 l25=l25 r19 g8 l25 q5+l5 u10 p10 ?l25 l25 l4+q4',
      'q3 ?b9 l25 g7 ?l3+g6 ?d9 ?l5+q3 l25 f4 l25 ?r25 f3 u3 q3 ?r3 ?l20 l12',
      'g4 y9 l5+r4 g10 ?q5 l25 l25 ?r12 f3 d20 q4 l25 p4+l5 l25 l5+r3 r3 ?l5',
    ],
    locks: [[2,6,18],[3,2,13]],
    solution: 'L1 L0 L0 L0 L0 L1 L0 L0 L0 L1 L0 L0 L0 L0 L0 P0 L0 L0 P0 L0 L1 L1 L1 L1 L1 L1 L1 L1 U0 P0 U0 P0 L1 L1 U1 L0 L0 L1 L0 P0 L0 L2 L2 L2 L1 L1 L1 L1 L2 L2 U1 U0 P0 L2 P0 L2 L2 U1 P1 L2 L1 L2 L3 L3 L3 L2 U1 P0 L2 U0 L3 P0 U0 L3 P1 L3 U1 U0 P1 L2 P1 L3 U1 U0 L2 P1 L2 P1 L2 L0 L3 U0 P0 U0 P0 L2 L3 L3 U0 L3 P0 L3 L3 L3 U0 L3 P0 L3 U0 L3 P0 U0 U0',
    stats: {jars: 75, moves: 113, nodes: 20882, casual: 0, firstMoves: 2, losing: 0, unknown: 0, parks: 20, parksExact: false, traps: 112, trapSteps: 60},
  },
};
