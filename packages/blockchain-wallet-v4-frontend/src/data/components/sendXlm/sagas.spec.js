import { expectSaga, testSaga } from 'redux-saga-test-plan'
import { initialize } from 'redux-form'
import { path, prop } from 'ramda'

import rootReducer from '../../rootReducer'
import { coreSagasFactory, Remote } from 'blockchain-wallet-v4/src'
import * as A from './actions'
import * as S from './selectors'
import * as C from 'services/AlertService'
import { FORM } from './model'
import { actions, selectors } from 'data'
import sendXlmSagas, { logLocation } from './sagas'
import { promptForSecondPassword } from 'services/SagaService'
import * as StellarSdk from 'stellar-sdk'

jest.mock('blockchain-wallet-v4/src/redux/sagas')
const api = {
  obtainSessionToken: jest.fn(),
  deauthorizeBrowser: jest.fn()
}
const coreSagas = coreSagasFactory({ api })

const STUB_ADDRESS = StellarSdk.Keypair.random().publicKey()
const STUB_FEE = 100

describe('sendXlm sagas', () => {
  // Mocking Math.random() to have identical popup ids for action testing
  const originalMath = Object.create(Math)
  const originalDate = Object.create(Date)
  const currentDate = Date.now()
  let pushStateSpy
  let locationReloadSpy
  beforeAll(() => {
    Math.random = () => 0.5
    Date.now = () => currentDate
    pushStateSpy = jest
      .spyOn(window.history, 'pushState')
      .mockImplementation(() => {})
    locationReloadSpy = jest
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {})
  })
  afterAll(() => {
    global.Math = originalMath
    global.Date = originalDate
    pushStateSpy.restore()
    locationReloadSpy.restore()
  })
  const {
    initialized,
    firstStepSubmitClicked,
    secondStepSubmitClicked
  } = sendXlmSagas({ coreSagas })

  const paymentMock = {
    value: jest.fn(),
    init: jest.fn(() => paymentMock),
    to: jest.fn(() => paymentMock),
    amount: jest.fn(() => paymentMock),
    from: jest.fn(() => paymentMock),
    fee: jest.fn(() => paymentMock),
    build: jest.fn(() => paymentMock),
    buildSweep: jest.fn(() => paymentMock),
    sign: jest.fn(() => paymentMock),
    publish: jest.fn(() => paymentMock),
    description: jest.fn(() => paymentMock),
    chain: jest.fn()
  }
  const value = { ...paymentMock, fee: STUB_FEE }
  paymentMock.value.mockReturnValue(value)

  coreSagas.payment.xlm.create.mockImplementation(() => {
    return paymentMock
  })

  describe('xlm send form initialize', () => {
    const from = 'fromxlmaddress'
    const type = 'ACCOUNT'
    const payload = { from, type }

    const saga = testSaga(initialized, { payload })
    const mockAccount = Remote.of([{ addr: STUB_ADDRESS }])

    const initialValues = {
      from: { addr: STUB_ADDRESS },
      coin: 'XLM',
      fee: STUB_FEE
    }

    const beforeEnd = 'beforeEnd'

    it('should trigger a loading action', () => {
      saga.next().put(A.paymentUpdated(Remote.Loading))
    })

    it('should create payment', () => {
      saga.next().call(paymentMock.init)
      expect(coreSagas.payment.xlm.create).toHaveBeenCalledTimes(1)
      expect(coreSagas.payment.xlm.create).toHaveBeenCalledWith()
    })

    it('should set payment from values based on payload', () => {
      saga.next(paymentMock).call(paymentMock.from, from, type)
    })

    it('should call payment from without params if from was not passed', () => {
      const { from, ...payloadWithoutFrom } = payload
      paymentMock.from.mockClear()
      return expectSaga(initialized, { payload: payloadWithoutFrom })
        .run()
        .then(() => {
          expect(paymentMock.from).toHaveBeenCalledTimes(1)
          expect(paymentMock.from).toHaveBeenCalledWith()
        })
    })

    it('should call payment from without params if type was not passed', () => {
      const { type, ...payloadWithoutType } = payload
      paymentMock.from.mockClear()
      return expectSaga(initialized, { payload: payloadWithoutType })
        .run()
        .then(() => {
          expect(paymentMock.from).toHaveBeenCalledTimes(1)
          expect(paymentMock.from).toHaveBeenCalledWith()
        })
    })

    it('should select default account', () => {
      saga
        .next(paymentMock)
        .select(selectors.core.common.xlm.getAccountBalances)
    })

    it('should initialize form with correct initial values', () => {
      saga.next(mockAccount).put(initialize(FORM, initialValues))
    })

    it('should trigger xlm payment updated success action', () => {
      saga
        .next()
        .put(A.paymentUpdated(Remote.of(value)))
        .save(beforeEnd)
        .next()
        .isDone()
    })

    describe('error handling', () => {
      const error = {}
      it('should log initialization error', () => {
        saga
          .restore(beforeEnd)
          .throw(error)
          .put(actions.logs.logErrorMessage(logLocation, 'initialized', error))
          .next()
          .isDone()
      })
    })

    describe('state change', () => {
      let resultingState = {}

      beforeEach(async () => {
        resultingState = await expectSaga(initialized, { payload })
          .withReducer(rootReducer)
          .run()
          .then(prop('storeState'))
      })

      it('should produce correct form state', () => {
        const form = path(FORM.split('.'), resultingState.form)
        expect(form.initial).toEqual(form.values)
        expect(form.initial).toEqual({
          from: {},
          coin: 'XLM',
          fee: STUB_FEE
        })
      })

      it('should produce correct sendXlm payment state', () => {
        expect(resultingState.components.sendXlm.payment).toEqual(
          Remote.Success(value)
        )
      })
    })
  })

  describe('xlm send first step submit', () => {
    beforeAll(() => {
      coreSagas.payment.xlm.create.mockClear()
      paymentMock.build.mockClear()
    })

    const saga = testSaga(firstStepSubmitClicked)

    const beforeError = 'beforeError'

    it('should select payment', () => {
      saga.next().select(S.getPayment)
    })

    it('should put loading action', () => {
      saga.next(Remote.of(paymentMock)).put(A.paymentUpdated(Remote.Loading))
    })

    it('should create payment from state value', () => {
      saga.next().call(coreSagas.payment.xlm.create, { payment: paymentMock })
    })

    it('should build payment', () => {
      saga.next(paymentMock).call(paymentMock.build)
    })

    it('should put update success action', () => {
      saga
        .next(paymentMock)
        .put(A.paymentUpdated(Remote.of(paymentMock.value())))
        .save(beforeError)
        .next()
        .isDone()
        .restore(beforeError)
    })

    describe('error handling', () => {
      const error = {}

      it('should log error', () => {
        saga
          .throw(error)
          .put(
            actions.logs.logErrorMessage(
              logLocation,
              'firstStepSubmitClicked',
              error
            )
          )
          .next()
          .isDone()
      })
    })
  })

  describe('xlm send second step submit', () => {
    const saga = testSaga(secondStepSubmitClicked)
    const secondPassword = 'password'
    const description = 'description'
    const txId = 'txId'
    const beforeError = 'beforeError'
    const from = { address: 'address' }
    beforeAll(() => {
      paymentMock.value.mockReturnValue({ ...value, description, txId, from })
      coreSagas.payment.xlm.create.mockClear()
      paymentMock.sign.mockClear()
      paymentMock.publish.mockClear()
    })

    it('should select payment', () => {
      saga.next().select(S.getPayment)
    })

    it('should create payment from state value', () => {
      saga
        .next(Remote.of(paymentMock))
        .call(coreSagas.payment.xlm.create, { payment: paymentMock })
    })

    it('should prompt for second password', () => {
      saga.next(paymentMock).call(promptForSecondPassword)
    })

    it('should sign payment with second passowrd', () => {
      saga.next(secondPassword).call(paymentMock.sign, secondPassword)
    })

    it('should publish payment', () => {
      saga.next(paymentMock).call(paymentMock.publish)
    })

    it('should update xlm data', () => {
      saga.next(paymentMock).put(actions.core.data.xlm.fetchData())
    })

    it('should put xlm payment updated success action', () => {
      saga.next().put(A.paymentUpdated(Remote.of(paymentMock.value())))
    })

    it('should set transaction note if payment has description', () => {
      saga.next().put(actions.core.kvStore.xlm.setTxNotesXlm(txId, description))
    })

    it('should display succcess message', () => {
      saga.next().put(actions.alerts.displaySuccess(C.SEND_XLM_SUCCESS))
    })

    it('should put action to close all modals', () => {
      saga
        .save(beforeError)
        .next()
        .put(actions.modals.closeAllModals())
        .next()
        .isDone()
    })

    describe('error handling', () => {
      const error = {}
      it('should log error', () => {
        saga
          .restore(beforeError)
          .throw(error)
          .put(
            actions.logs.logErrorMessage(
              logLocation,
              'secondStepSubmitClicked',
              error
            )
          )
      })

      it('should display error message', () => {
        saga
          .next()
          .put(actions.alerts.displayError(C.SEND_XLM_ERROR))
          .next()
      })
    })
  })
})
