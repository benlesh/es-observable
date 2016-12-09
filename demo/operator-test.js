import { Observable } from '../src/Observable';
import CancelToken from '../src/CancelToken';

function flatten(observable) {
    return new Observable((observer, token) => {
        let outerObservableDone = false;
        let innerObservables = 0;

        observable.subscribe({
            next(innerObservable) {
                innerObservables++;

                innerObservable.subscribe(
                    {
                        next(value) {
                            observer.next(value);
                        },
                        catch(e) {
                            innerObservables--;
                            observer.throw(e);
                        },
                        complete(v) {
                            innerObservables--;
                            if (innerObservables === 0 && outerObservableDone) {
                                observer.complete(v);
                            }
                        }
                    },
                    token);
            },
            catch(e) {
                observer.throw(e);
            },
            complete(v) {
                outerObservableDone = true;
                if (innerObservables === 0) {
                    observer.complete(v);
                }
            }
        },
        token);
    });
}

function switch(observable) {
    return new Observable((observer, token) => {
        let outerObservableDone = false;
        let innerCancel;

        observable.subscribe({
            next(innerObservable) {
                if (innerCancel) {
                    innerCancel(new Cancel());
                    innerCancel = null;
                }

                let { preInnerToken: token, preInnerCancel: cancel } = CancelToken.source();
                let innerToken = CancelToken.race([token, preInnerToken]);
                innerCancel = preInnerCancel;

                innerObservable.subscribe(
                    {
                        next(value) {
                            observer.next(value);
                        },
                        catch(e) {
                            observer.throw(e);
                        },
                        complete(v) {
                            innerCancel = null;
                            if (outerObservableDone) {
                                observer.complete(v);
                            }
                        }
                    },
                    innerToken);
            },
            catch(e) {
                observer.throw(e);
            },
            complete(v) {
                outerObservableDone = true;
                if (innerCancel == null) {
                    observer.complete(v);
                }
            }
        },
        token);
    });
}

function map(observable, projection) {
    return new Observable((observer, token) => {
        const self = this;
        let index = 0;
        observable.subscribe(
            {
                next(value) {
                    try {
                        value = projection(value, index++, self);
                    }
                    catch(e) {
                        return observer.throw(e);
                    }

                    observer.next(value);
                },
                catch(e) {
                    observer.throw(e);
                },
                complete(v) {
                    observer.complete(v);
                }
            },
            token);
    });
}

function filter(observable, predicate) {
    return new Observable((observer, token) => {
        const self = this;
        let index = 0;

        observable.subscribe(
            {
                next(value) {
                    let include;
                    try {
                        include = predicate(value, index++, self);
                    }
                    catch(e) {
                        return observer.throw(e);
                    }

                    if (include) {
                        observer.next(value);
                    }
                },
                catch(e) {
                    observer.throw(e);
                },
                complete(v) {
                    observer.complete(v);
                }
            },
            token);
    });
}

// take seems fine. Although, I'm not sure I'm implemented it properly
// WRT `catch` vs `throw` vs `else`. A little confusing. I chose to passthrough
// `throw` from `catch` here.
function take(count) {
  return new Observable((observer, token) => {
    let counter = 0;
    this.subscribe({
      next(v) {
        observer.next(v);
        counter++;
        if (counter === count) {
          observer.complete();
        }
      },
      catch(e) {
        observer.throw(e);
      },
      complete(v) {
        observer.complete(v);
      }
    }, token);
  });
}

// the range observable is pretty straightforward, however I think checking
// `token.reason` is pretty unergonomic. I doing a `typeof` here because I assume
// that someone might supply a reason of `false` or `""`, which breaks `!token.reason`
function range(start, end) {
  return new Observable((observer, token) => {
    for (let i = start; typeof token.reason === 'undefined' && i < end; i++) {
      observer.next(i);
    }
    observer.complete();
  });
}

// The `else` operator would be the equivalent to the modern `catch` operator
// in RxJS... however it seems weird that I'd name it this way. Will `Promise` also
// change their API from `Promise.prototype.catch` to `Promise.prototype.else`?
// These names need work. I think it should probably be
// `try { } catch (anyErr) { } error (err) { } cancel (cancelErr) { }` or the like
function else(handler) {
  return new Observable((observer, token) => {
    this.subscribe({
      next(v) {
        observer.next(v);
      },
      else(err) {
        try {
          const nextObs = handler(err);
          nextObs.subscribe(observer, token);
        } catch (err) {
          observer.throw(err);
        }
      },
      complete(v) {
        observer.complete(v);
      }
    }, token);
  });
}


// RxJS's finally operator seems weirdly trivial. Is this wrong?
function finally(handler) {
  return new Observable((observer, token) => {
    token.promise.finally(handler);
    this.subscribe(observer, token);
  });
}

// RxJS's repeat operator. Seems, again, pretty straightforward.
function repeat(count) {
  return new Observable((observer, token) => {
    let counter = 0;
    const sub = () =>
      this.subscribe({
        next(v) { observer.next(v); },
        catch(err) { observer.throw(err); },
        complete(v) {
          counter++;
          if (counter < count) {
            sub(); // RxJS may schedule here
          }
        }
      }, token);
  });
}

// takeUntil is extremely simple... however, I'd be interested to know
// from testing if I had to create a seperate innerToken for the end subscription
// that I needed to cancel (see `takeUntil2`)
function takeUntil(notifier) {
  return new Observable((observer, token) => {
    notifier.subscribe({
      next(v) {
        observer.complete();
      }
    }, token);

    this.subscribe(observer, token);
  });
}

// cont'd from above... is this a better `takeUntil` implementation? There might
// be some nuance with CancelToken I'm not grasping.
function takeUntil2(notifier) {
  return new Observable((observer, token) => {
    const { innerCancel: cancel, innerToken: token } = CancelToken.source();
    const finalToken = CancelToken.race([token, innerToken]);

    notifier.subscribe({
      next(v) {
        observer.complete();
        cancel();
      }
    }, token);

    this.subscribe(observer, finalToken);
  });
}

var { token, cancel } = CancelToken.source();

flatten(map(filter(Observable.of(1,2,3,4), x => x > 2), x => Observable.of(9,10,11))).forEach(v => console.log(v)).then(() => console.log("COMPLETE"), e => console.error("ERROR"));
