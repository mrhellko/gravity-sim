import type { BodyInitialState } from './physics/types';

export const SOLAR_SYSTEM_EPOCH = '2026-06-16';
export const SOLAR_SYSTEM_EPOCH_DETAILS = '2026-06-16 00:00:00 TDB';
export const SOLAR_SYSTEM_GRAVITY = 990.6930562367693;
export const SOLAR_SYSTEM_SOFTENING = 0.001;

const solarSystemBodies: BodyInitialState[] = [
  {
    id: 'sun',
    name: 'Sun',
    mass: 1,
    radius: 0.6957,
    color: 0xffcc66,
    position: [-0.2868085651543554, -0.8032541105653856, 0.01625072189312021],
    velocity: [0.0009795306882118225, 0.000266072830493578, -0.0000200915297419543],
    pinned: false,
  },
  {
    id: 'mercury',
    name: 'Mercury',
    mass: 1.6601208254808336e-7,
    radius: 0.0024397,
    color: 0xb7a99a,
    position: [-54.71900593971178, -36.23953510137703, 2.112639987255169],
    velocity: [1.433144958676349, -3.341544778581855, -0.4044794944852792],
    pinned: false,
  },
  {
    id: 'venus',
    name: 'Venus',
    mass: 0.0000024478382877847715,
    radius: 0.0060518,
    color: 0xe8c27a,
    position: [-107.6955635492446, -6.81080556881101, 6.131114463666806],
    velocity: [0.151666405958979, -3.034205542923186, -0.05040491230676453],
    pinned: false,
  },
  {
    id: 'earth',
    name: 'Earth',
    mass: 0.000003003489614915764,
    radius: 0.006371,
    color: 0x75b8ff,
    position: [-14.78952510435585, -152.0709243003808, 0.02509505665383488],
    velocity: [2.522372147681953, -0.2548951862384856, 0.000037396702870236],
    pinned: false,
  },
  {
    id: 'mars',
    name: 'Mars',
    mass: 3.2271514450538653e-7,
    radius: 0.0033895,
    color: 0xd66b4d,
    position: [190.0115697184496, 95.57650405400986, -2.630209466815148],
    velocity: [-0.8647116545839852, 2.046687715189961, 0.06409335674868551],
    pinned: false,
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    mass: 0.0009547919099366768,
    radius: 0.069911,
    color: 0xd9b38c,
    position: [-424.3876733369342, 663.9352586711835, 6.743583266763836],
    velocity: [-0.964637161874789, -0.5547246458459255, 0.02388936098176294],
    pinned: false,
  },
  {
    id: 'saturn',
    name: 'Saturn',
    mass: 0.0002858856727222417,
    radius: 0.058232,
    color: 0xe0c586,
    position: [1403.757743260902, 175.5213052957192, -58.94376896360213],
    velocity: [-0.1493642484404896, 0.8263832440776032, -0.008461479518228218],
    pinned: false,
  },
  {
    id: 'uranus',
    name: 'Uranus',
    mass: 0.00004366244043351538,
    radius: 0.025362,
    color: 0x98e6e6,
    position: [1391.903263947369, 2555.983817435473, -8.539644705504776],
    velocity: [-0.5210630672901874, 0.2539707396812137, 0.007708071604525525],
    pinned: false,
  },
  {
    id: 'neptune',
    name: 'Neptune',
    mass: 0.000051513890204661145,
    radius: 0.024622,
    color: 0x5f86ff,
    position: [4465.809960550096, 155.194285922987, -106.1151473265631],
    velocity: [-0.01946300088735235, 0.4721010228218338, -0.009229298861247409],
    pinned: false,
  },
];

export function createSolarSystemInitialBodies(): BodyInitialState[] {
  return solarSystemBodies.map((body) => ({
    ...body,
    position: [...body.position],
    velocity: [...body.velocity],
  }));
}
