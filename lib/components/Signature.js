//@flow
import Expo from 'expo';
import React from 'react';
import { PanResponder, PixelRatio } from 'react-native';

import PIXI from '../Pixi';
import { takeSnapshotAsync } from '../utils';
import { vec2 } from 'gl-matrix';
import BezierProvider from '../core/SignatureBezierProvider';
import { lineAverage, lineCreate, linesPerpendicularToLine } from '../core/Perpendicular';

global.__ExpoSignatureId = global.__ExpoSignatureId || 0;

type Props = {
  strokeColor: number | string,
  strokeWidth: number,
  strokeAlpha: number,
  onChange: () => PIXI.Renderer,
  onReady: () => WebGLRenderingContext,
  initialLines?: Array<Point>,
};

const scale = PixelRatio.get();

function scaled({ locationX: x, locationY: y }) {
  const out = vec2.fromValues(x, y);
  vec2.scale(out, out, scale);
  return out;
}

type Point = {
  x: number,
  y: number,
  color: string | number,
  width: number,
  alpha: number,
};

export default class Signature extends React.Component<Props> {
  lines = [];
  stage: PIXI.Stage;
  graphics;
  points = [];
  lastPoint: Point;
  lastTime: number;
  ease: number = 0.3; // only move 0.3 in the direction of the pointer, this smooths it out
  delay: number = 10;
  panResponder: PanResponder;
  renderer: PIXI.Renderer;

  provider = new BezierProvider();

  componentDidMount() {
    this._doDotSub = this.provider.addListener('doDot', this._doDot);
  }

  componentWillUnmount() {
    this._doDotSub.remove();
  }

  componentWillMount() {
    global.__ExpoSignatureId++;
    this.setupPanResponder();
  }

  _doDot = (points, finalized) => {
    this.graphics.clear();

    const [x, y] = points[0].point;

    this.graphics.arc(x, y, points[0].weight, 0, Math.PI * 2, true);
    this._checkFinalized(finalized);
  };

  _doLine = (points, finalized) => {
    this.graphics.clear();

    const { first, second } = linesPerpendicularToLine(points[0], points[1]);

    this.graphics.moveTo(first[0][0], first[0][1]);
    this.graphics.lineTo(second[0][0], second[0][1]);
    this.graphics.lineTo(second[1][0], second[1][1]);
    this.graphics.lineTo(first[0][0], first[0][1]);
    this._checkFinalized(finalized);
  };

  _doQuadCurve = (points, finalized) => {
    this.graphics.clear();

    const linesAB = linesPerpendicularToLine(points[0], points[1]);
    const linesBC = linesPerpendicularToLine(points[1], points[2]);

    const lineA = linesAB.first;
    const lineB = lineAverage(lineCreate(), linesAB.second, linesBC.first);
    const lineC = linesBC.second;

    this.graphics.moveTo(lineA[0][0], lineA[0][1]);
    this.graphics.quadraticCurveTo(lineB[0][0], lineB[0][1], lineC[0][0], lineC[0][1]);
    this.graphics.lineTo(lineC[1][0], lineC[1][1]);
    this.graphics.quadraticCurveTo(lineB[1][0], lineB[1][1], lineA[1][0], lineA[1][1]);
    this._checkFinalized(finalized);
  };

  _doBezierCurve = (points, finalized) => {
    this.graphics.clear();

    const linesAB = linesPerpendicularToLine(points[0], points[1]);
    const linesBC = linesPerpendicularToLine(points[1], points[2]);
    const linesCD = linesPerpendicularToLine(points[2], points[3]);

    const lineA = linesAB.first;
    const lineB = lineAverage(lineCreate(), linesAB.second, linesBC.first);
    const lineC = lineAverage(lineCreate(), linesBC.second, linesCD.first);
    const lineD = linesCD.second;

    this.graphics.moveTo(lineA[0][0], lineA[0][1]);
    this.graphics.bezierCurveTo(
      lineB[0][0],
      lineB[0][1],
      lineC[0][0],
      lineC[0][1],
      lineD[0][0],
      lineD[0][1]
    );
    this.graphics.lineTo(lineD[1][0], lineD[1][1]);
    this.graphics.bezierCurveTo(
      lineC[1][0],
      lineC[1][1],
      lineB[1][0],
      lineB[1][1],
      lineA[1][0],
      lineA[1][1]
    );
    this._checkFinalized(finalized);
  };

  _checkFinalized = finalized => {
    this.graphics.currentPath.shape.closed = false;
    this.graphics.endFill(); /// TODO: this may be wrong: need stroke
    this.renderer._update();

    if (finalized) {
      //      this.persistStroke();
      this.graphics = new PIXI.Graphics();
      this.stage.addChild(this.graphics);
    }
  };

  setupPanResponder = () => {
    const onEnd = nativeEvent => {
      this.provider.addPointToSignature(scaled(nativeEvent));
      this.provider.reset();
      // false

      setTimeout(() => this.props.onChange && this.props.onChange(this.renderer), 1);
    };

    this.panResponder = PanResponder.create({
      onStartShouldSetResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => true,
      onPanResponderGrant: ({ nativeEvent }) => {
        this.provider.addPointToSignature(scaled(nativeEvent));
        // true
      },
      onPanResponderMove: ({ nativeEvent }) => {
        // throttle updates: once for every 10ms
        const time = Date.now();
        const delta = time - this.lastTime;
        if (delta < this.delay) return;
        this.lastTime = time;

        this.provider.addPointToSignature(scaled(nativeEvent));
        // false
      },
      onPanResponderRelease: ({ nativeEvent }) => onEnd(nativeEvent),
      onPanResponderTerminate: ({ nativeEvent }) => onEnd(nativeEvent),
    });
  };

  shouldComponentUpdate = () => false;

  persistStroke = () => {
    if (this.graphics) {
      this.graphics.points = this.points;
      this.lines.push(this.graphics);
    }
    this.lastTime = 0;
    this.points = [];
  };

  // drawLine(point: Point, newLine: boolean) {
  //   if (!this.renderer || (!newLine && !this.graphics)) {
  //     return;
  //   }

  //   if (newLine) {
  //     this.persistStroke();
  //     this.graphics = new PIXI.Graphics();
  //     this.stage.addChild(this.graphics);
  //     this.lastPoint = point;
  //     this.points = [point];
  //     return;
  //   }
  //   this.lastPoint = point;
  //   this.points.push(point);

  //   this.graphics.clear();
  //   for (let i = 0; i < this.points.length; i++) {
  //     const { x, y, color, width, alpha } = this.points[i];
  //     if (i === 0) {
  //       this.graphics.lineStyle(
  //         width || this.props.strokeWidth || 10,
  //         color || this.props.strokeColor || 0x000000,
  //         alpha || this.props.strokeAlpha || 1
  //       );
  //       this.graphics.moveTo(x, y);
  //     } else {
  //       this.graphics.lineTo(x, y);
  //     }
  //   }
  //   this.graphics.currentPath.shape.closed = false;
  //   this.graphics.endFill(); /// TODO: this may be wrong: need stroke
  //   this.renderer._update();
  // }

  undo = () => {
    if (!this.renderer) {
      return null;
    }

    const { children } = this.stage;
    if (children.length > 0) {
      const child = children[children.length - 1];
      this.stage.removeChild(child);
      this.renderer._update();
      // TODO: This doesn't really work :/
      setTimeout(() => this.props.onChange && this.props.onChange(this.renderer), 2);
      return child;
    } else if (this.points.length > 0) {
      this.persistStroke();
      return this.undo();
    }
  };

  takeSnapshotAsync = (...args) => {
    return takeSnapshotAsync(this.glView, ...args);
  };

  onContextCreate = async (context: WebGLRenderingContext) => {
    this.context = context;
    this.stage = new PIXI.Container();

    const getAttributes = context.getContextAttributes || (() => ({}));
    context.getContextAttributes = () => {
      const contextAttributes = getAttributes();
      return {
        ...contextAttributes,
        stencil: true,
      };
    };

    this.renderer = PIXI.autoDetectRenderer(
      context.drawingBufferWidth,
      context.drawingBufferHeight,
      {
        context,
        antialias: true,
        backgroundColor: 'transparent',
        transparent: true,
        autoStart: false,
      }
    );
    this.renderer._update = () => {
      this.renderer.render(this.stage);
      context.endFrameEXP();
    };
    this.props.onReady && this.props.onReady(context);

    this.graphics = new PIXI.Graphics();
    this.stage.addChild(this.graphics);

    // const { initialLines } = this.props;
    // if (initialLines) {
    //   for (let line of initialLines) {
    //     this.buildLine(line);
    //   }
    //   this.lines = initialLines;
    // }
  };

  // buildLine = ({ points, color, alpha, width }) => {
  //   for (let i = 0; i < points.length; i++) {
  //     this.drawLine({ color, alpha, width, ...points[i] }, i === 0);
  //   }
  // };

  onLayout = ({ nativeEvent: { layout: { width, height } } }) => {
    if (this.renderer) {
      const scale = PixelRatio.get();
      this.renderer.resize(width * scale, height * scale);
      this.renderer._update();
    }
  };

  setRef = ref => {
    this.glView = ref;
  };

  render() {
    return (
      <Expo.GLView
        {...this.panResponder.panHandlers}
        onLayout={this.onLayout}
        key={'Expo.Signature-' + global.__ExpoSignatureId}
        ref={this.setRef}
        {...this.props}
        onContextCreate={this.onContextCreate}
      />
    );
  }
}
