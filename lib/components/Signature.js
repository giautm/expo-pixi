//@flow
import Expo from 'expo';
import React from 'react';
import { PanResponder, PixelRatio } from 'react-native';
import { vec2 } from 'gl-matrix';

import PIXI from '../Pixi';
import { takeSnapshotAsync } from '../utils';
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
  stageFinalized: PIXI.Stage;
  stageTemporary: PIXI.Stage;

  graphics;
  graphicsTmp;

  panResponder: PanResponder;
  renderer: PIXI.Renderer;

  provider = new BezierProvider();

  componentDidMount() {
    this._doDotSub = this.provider.addListener('doDot', this._doDot);
    this._doLineSub = this.provider.addListener('doLine', this._doLine);
    this._doQuadCurveSub = this.provider.addListener('doQuadCurve', this._doQuadCurve);
    this._doBezierCurveSub = this.provider.addListener('doBezierCurve', this._doBezierCurve);
  }

  componentWillUnmount() {
    this._doDotSub.remove();
  }

  componentWillMount() {
    global.__ExpoSignatureId++;
    this.setupPanResponder();
  }

  _doDot = (points, finalized) => {
    const { point, weight } = points[0];

    this.graphicsTmp.clear();
    const graphics = finalized ? this.graphics : this.graphicsTmp;
    graphics.beginFill(this.props.strokeColor);
    graphics.lineStyle(1, this.props.strokeColor, 1);

    graphics.arc(point[0], point[1], weight, 0, Math.PI * 2, true);
    graphics.endFill();

    this.renderer._update();
  };

  _doLine = (points, finalized) => {
    const { first, second } = linesPerpendicularToLine(points[0], points[1]);

    this.graphicsTmp.clear();
    const graphics = finalized ? this.graphics : this.graphicsTmp;
    graphics.beginFill(this.props.strokeColor);
    graphics.lineStyle(1, this.props.strokeColor, 1);

    graphics.moveTo(first[0][0], first[0][1]);
    graphics.lineTo(second[0][0], second[0][1]);
    graphics.lineTo(second[1][0], second[1][1]);
    graphics.lineTo(first[0][0], first[0][1]);
    graphics.closePath();
    graphics.endFill();

    this.renderer._update();
  };

  _doQuadCurve = (points, finalized) => {
    const linesAB = linesPerpendicularToLine(points[0], points[1]);
    const linesBC = linesPerpendicularToLine(points[1], points[2]);

    const lineA = linesAB.first;
    const lineB = lineAverage(lineCreate(), linesAB.second, linesBC.first);
    const lineC = linesBC.second;

    this.graphicsTmp.clear();
    const graphics = finalized ? this.graphics : this.graphicsTmp;
    graphics.beginFill(this.props.strokeColor);
    graphics.lineStyle(1, this.props.strokeColor, 1);

    graphics.moveTo(lineA[0][0], lineA[0][1]);
    graphics.quadraticCurveTo(lineB[0][0], lineB[0][1], lineC[0][0], lineC[0][1]);
    graphics.lineTo(lineC[1][0], lineC[1][1]);
    graphics.quadraticCurveTo(lineB[1][0], lineB[1][1], lineA[1][0], lineA[1][1]);
    graphics.closePath();
    graphics.endFill();

    this.renderer._update();
  };

  _doBezierCurve = (points, finalized) => {
    const linesAB = linesPerpendicularToLine(points[0], points[1]);
    const linesBC = linesPerpendicularToLine(points[1], points[2]);
    const linesCD = linesPerpendicularToLine(points[2], points[3]);

    const lineA = linesAB.first;
    const lineB = lineAverage(lineCreate(), linesAB.second, linesBC.first);
    const lineC = lineAverage(lineCreate(), linesBC.second, linesCD.first);
    const lineD = linesCD.second;

    this.graphicsTmp.clear();
    const graphics = finalized ? this.graphics : this.graphicsTmp;
    graphics.beginFill(this.props.strokeColor);
    graphics.lineStyle(1, this.props.strokeColor, 1);

    graphics.moveTo(lineA[0][0], lineA[0][1]);
    graphics.bezierCurveTo(
      lineB[0][0],
      lineB[0][1],
      lineC[0][0],
      lineC[0][1],
      lineD[0][0],
      lineD[0][1]
    );
    graphics.lineTo(lineD[1][0], lineD[1][1]);
    graphics.bezierCurveTo(
      lineC[1][0],
      lineC[1][1],
      lineB[1][0],
      lineB[1][1],
      lineA[1][0],
      lineA[1][1]
    );
    graphics.closePath();
    graphics.endFill();

    this.renderer._update();
  };

  setupPanResponder = () => {
    const onEnd = nativeEvent => {
      this.provider.addPointToSignature(scaled(nativeEvent));
      this.provider.reset();

      setTimeout(() => this.props.onChange && this.props.onChange(this.renderer), 1);
    };

    this.panResponder = PanResponder.create({
      onStartShouldSetResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => true,
      onPanResponderGrant: ({ nativeEvent }) => {
        this._beginNewLine();
        this.provider.reset();
        this.provider.addPointToSignature(scaled(nativeEvent));
      },
      onPanResponderMove: ({ nativeEvent }) => {
        this.provider.addPointToSignature(scaled(nativeEvent));
      },
      onPanResponderRelease: ({ nativeEvent }) => onEnd(nativeEvent),
      onPanResponderTerminate: ({ nativeEvent }) => onEnd(nativeEvent),
    });
  };

  shouldComponentUpdate = () => false;

  undo = () => {
    if (!this.renderer) {
      return null;
    }

    const { children } = this.stageFinalized;
    if (children.length > 0) {
      const child = children[children.length - 1];
      this.stageFinalized.removeChild(child);
      this.renderer._update();
      // TODO: This doesn't really work :/
      setTimeout(() => this.props.onChange && this.props.onChange(this.renderer), 2);
      return child;
    }
  };

  takeSnapshotAsync = (...args) => {
    return takeSnapshotAsync(this.glView, ...args);
  };

  _beginNewLine = () => {
    this.graphics = new PIXI.Graphics();
    this.graphics.beginFill(this.props.strokeColor);
    this.graphics.lineStyle(1, this.props.strokeColor, 1);
    this.stageFinalized.addChild(this.graphics);
  };

  onContextCreate = async (context: WebGLRenderingContext) => {
    this.context = context;
    this.stageFinalized = new PIXI.Container();

    this.graphicsTmp = new PIXI.Graphics();
    this.graphicsTmp.beginFill(this.props.strokeColor);
    this.graphicsTmp.lineStyle(1, this.props.strokeColor, 1);
    this.stageFinalized.addChild(this.graphicsTmp);

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
      this.renderer.render(this.stageFinalized);
      context.endFrameEXP();
    };
    this.props.onReady && this.props.onReady(context);
  };

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
