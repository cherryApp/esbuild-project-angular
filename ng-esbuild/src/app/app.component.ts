import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ConfigService } from './service/config.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  title = 'Cserkó Abigél';

  list$: BehaviorSubject<{name: string}[]> = new BehaviorSubject<{name: string}[]>([]);

  listObserver$: Observable<any> = this.list$.asObservable();

  list = this.config.testList;

  users = [
    {name: 'Gizike'},
    {name: 'Géza'},
    {name: 'Jancsi'},
    {name: 'Marcsi'},
    {name: 'Cili'},
  ];

  constructor(
    private config: ConfigService,
  ) {}

  ngOnInit(): void {
      this.config.getAll().subscribe(
        users => console.log(users),
        err => console.error(err),
      );
  }
}
